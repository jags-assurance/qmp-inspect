import { ActivityDetails } from "./activity-details";
import { Badge } from "@/components/ui/badge";
import { InterventionSelect, type InterventionLevelOption } from "@/components/domain/intervention-select";
import { SignoffCell } from "@/components/domain/signoff-cell";
import { evaluateNotice } from "@/lib/signoff/notice-check";
import { ItemControls } from "./item-controls";
import { ActivityChecklistToggle, type ActivityChecklist } from "./activity-checklist-toggle";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import type { InterventionLevel } from "@jags/shared-types";
import { cn } from "@/lib/cn";
import { T } from "@/components/domain/t";
import type { CSSProperties } from "react";
import { ScrollRegion } from "./scroll-region";

export interface PartySignoffCell {
  party: { id: string; name: string; user_id: string | null };
  intervention: InterventionLevel | null;
  signoff: { id: string; status: SignoffStatus; notified_at: string | null; signoffComment?: string | null; rejectionReason?: string | null } | null;
  /** Whether the CURRENT user may sign off for this specific party — see canSignOffForParty in lib/signoff/actions.ts. */
  canSignOff: boolean;
}

export interface GridRow {
  itemId: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  referenceSpec?: string | null;
  method?: string | null;
  frequency?: string | null;
  evidenceLabel: string;
  /** Raw evidence_type (1/2/3) and discipline_id, alongside their display-only evidenceLabel/
   *  disciplineCode above — ItemControls' edit form needs the raw values to pre-fill its selects. */
  evidenceType: number;
  /** Checklist-type activities only: the checklist (or the draft it will start from) shown when the
   *  evidence pill is clicked. */
  checklist: ActivityChecklist | null;
  disciplineId: string | null;
  disciplineCode: string | null;
  /** R25: this activity's own notice-period override (itp_items.notice_hours_override), if set —
   *  takes precedence over the level-keyed `noticeHours` map below for every cell in this row. */
  noticeHoursOverride: number | null;
  /** Planned date (yyyy-mm-dd) for this activity, if set. */
  plannedDate?: string | null;
  /** S3-06: registers this activity explicitly requires. */
  requiredRegisters?: string[];
  /** One cell per project_party involved in this ITP, in the same order as `parties` below —
   *  same per-activity computation the previous card layout used (partyCells), just consumed as a
   *  table row instead of a chip chain. */
  partyCells: PartySignoffCell[];
}

// A blocking level (Hold-equivalent, per this organisation's own intervention_level_types —
// is_blocking is no longer implied by the literal code "H") is the only kind that ever blocks
// progress outright (R66-R81) — a thicker, tinted background makes that meaningfully more prominent
// than a non-blocking level's cell, which stays neutral. A party with no intervention set at all
// gets a plain background so it reads as "not applicable" rather than "missing data" (the "—"
// InterventionSelect/blank already renders is what actually communicates "empty" here).
function cellToneClass(intervention: InterventionLevel | null, isBlocking: boolean): string {
  if (intervention && isBlocking) return "bg-burgundy/5";
  if (intervention) return "bg-surface-subtle/60";
  return "bg-transparent";
}

// Column geometry shared by the header row and every activity row (>= md). The activity column flexes,
// each party column has a floor so its status chip, primary action and "..." menu always fit.
const ACTIVITY_COL_PX = 260;
const PARTY_COL_PX = 156;

/**
 * One section's H/W/R/S sign-off grid: rows = activities, columns = project parties, matching the
 * literal grid layout real client ITP reference documents use (one column per inspecting party).
 * Replaces the previous per-activity ActivitySignoffCard "chain of chips" layout — every action and
 * business rule InterventionSelect and SignoffCell enforce is unchanged, this only changes how they
 * are composed (a real <table> instead of a wrapped flex row of cards).
 *
 * Responsive (one DOM, CSS only, so every cell exists once and keeps its own state):
 *  - >= 1280 (xl): compact grid. Activity column sticks at the start, one column per party; each cell is
 *    level badge + status icon/text + ONE primary action with the rest in a "..." menu.
 *  - 768-1279 (md): the same grid in a horizontally scrolling, keyboard-focusable region with the activity
 *    column pinned, a right-edge fade and a hint line so the scroll is discoverable.
 *  - < 768: each activity is a card: title and details first, then one block per party (name, level,
 *    status icon + text, primary action + menu). Parties with no level on the activity are omitted from the
 *    card for read-only viewers only ("no part in this activity" carries no information on a phone).
 */
export function ActivitySignoffGrid({
  itpId,
  rows,
  parties,
  canEditContent,
  isJagsStaff,
  noticeHours,
  levels,
  blockingCodes,
  disciplines,
  isIssued,
}: {
  itpId: string;
  rows: GridRow[];
  /** Column axis — the same project_parties iterated to build each row's partyCells, in that order. */
  parties: { id: string; name: string }[];
  canEditContent: boolean;
  isJagsStaff: boolean;
  /** Notice-period hours keyed by this organisation's own intervention level codes (project override
   *  if set, else that level's default_notice_hours, else the built-in H=48/W=24 fallback). */
  noticeHours: Record<string, number>;
  /** This ITP's ORGANISATION's configured intervention levels, in sort_order — replaces the old
   *  hardcoded H/W/R/S set so a custom level shows up in the picker and renders correctly here. */
  levels: InterventionLevelOption[];
  /** Codes configured as is_blocking=true for this organisation. */
  blockingCodes: Set<string>;
  /** For ItemControls' edit form's discipline picker — same list AddItemForm already receives. */
  disciplines: { id: string; code: string; name: string }[];
  /** R101: whether an item edit/delete here needs a revision reason (ItemControls). */
  isIssued: boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-muted"><T>No activities in this section yet.</T></p>;
  }

  if (parties.length === 0) {
    return <p className="px-3 py-6 text-center text-muted"><T>No project parties configured for this project yet.</T></p>;
  }

  const labelId = `grid-label-${rows[0].itemId}`;
  const gridVars = {
    "--grid-cols": `minmax(${ACTIVITY_COL_PX}px,1.6fr) repeat(${parties.length}, minmax(${PARTY_COL_PX}px,1fr))`,
    "--grid-min": `${ACTIVITY_COL_PX + PARTY_COL_PX * parties.length}px`,
  } as CSSProperties;

  return (
    <div className="relative">
      <span id={labelId} className="sr-only"><T>Activities and party sign-offs</T></span>
      <ScrollRegion
        labelledBy={labelId}
        fade={parties.length >= 3}
        hint={
          <p className="hidden items-center gap-1.5 px-4 pb-2 text-xs text-muted md:flex">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 rtl:-scale-x-100">
              <path d="M4 10h12M12 6l4 4-4 4" />
            </svg>
            <T>Scroll sideways to see every party. The activity column stays in place.</T>
          </p>
        }
      >
        <div role="table" aria-labelledby={labelId} style={gridVars} className="text-sm md:min-w-[var(--grid-min)]">
          <div role="row" className="hidden border-y border-border bg-surface-subtle text-xs text-muted md:grid md:[grid-template-columns:var(--grid-cols)]">
            <div role="columnheader" className="sticky start-0 z-[1] bg-surface-subtle px-4 py-2 font-medium"><T>Activity</T></div>
            {parties.map((party) => (
              <div key={party.id} role="columnheader" className="border-s border-border/60 px-3 py-2 font-medium">
                <span className="block truncate" title={party.name}>
                  {party.name}
                </span>
              </div>
            ))}
          </div>
          <div role="rowgroup" className="max-md:space-y-3 max-md:px-3 max-md:pb-3">
            {rows.map((row) => (
              <div
                key={row.itemId}
                role="row"
                className="max-md:overflow-hidden max-md:rounded-lg max-md:border max-md:border-border max-md:bg-surface md:grid md:[grid-template-columns:var(--grid-cols)] md:border-b md:border-border md:last:border-0"
              >
                <div role="cell" className="min-w-0 bg-surface px-4 py-3 md:sticky md:start-0 md:z-[1]">
                  {canEditContent ? (
                    <ItemControls
                      itpId={itpId}
                      itemId={row.itemId}
                      itemNumber={row.itemNumber}
                      activity={row.activity}
                      acceptanceCriteria={row.acceptanceCriteria}
                      referenceSpec={row.referenceSpec ?? null}
                      method={row.method ?? null}
                      frequency={row.frequency ?? null}
                      evidenceType={row.evidenceType}
                      disciplineId={row.disciplineId}
                      noticeHoursOverride={row.noticeHoursOverride}
                      plannedDate={row.plannedDate ?? null}
                      requiredRegisters={row.requiredRegisters ?? []}
                      disciplines={disciplines}
                      isIssued={isIssued}
                    />
                  ) : (
                    <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                      <span className="doc-id me-1.5 text-muted">{row.itemNumber}</span>
                      {row.activity}
                    </p>
                  )}
                  {!canEditContent && (
                    <ActivityDetails acceptanceCriteria={row.acceptanceCriteria} referenceSpec={row.referenceSpec} method={row.method} frequency={row.frequency} />
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <ActivityChecklistToggle label={row.evidenceLabel} checklist={row.checklist} />
                    {row.disciplineCode && <Badge tone="neutral">{row.disciplineCode}</Badge>}
                    {row.plannedDate && <Badge tone="neutral"><T>Planned:</T> {row.plannedDate}</Badge>}
                    {row.noticeHoursOverride != null && (
                      <Badge tone="neutral"><T>Notice:</T> {row.noticeHoursOverride}<T>h</T></Badge>
                    )}
                  </div>
                </div>
                {row.partyCells.map(({ party, intervention, signoff, canSignOff }) => (
                  <div
                    key={party.id}
                    role="cell"
                    className={cn(
                      "min-w-0 space-y-2 px-4 py-3 md:border-s md:border-border/60 md:px-3",
                      "max-md:border-t max-md:border-border",
                      cellToneClass(intervention, !!intervention && blockingCodes.has(intervention)),
                      !intervention && !canEditContent && "max-md:hidden"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 md:justify-start">
                      <span className="min-w-0 truncate text-sm font-medium text-ink md:hidden" title={party.name}>
                        {party.name}
                      </span>
                      <InterventionSelect
                        itpId={itpId}
                        itpItemId={row.itemId}
                        projectPartyId={party.id}
                        value={intervention}
                        editable={canEditContent}
                        levels={levels}
                        isIssued={isIssued}
                      />
                    </div>
                    {intervention && signoff && (
                      <SignoffCell
                        layout="compact"
                        progressId={signoff.id}
                        isBlocking={blockingCodes.has(intervention)}
                        status={signoff.status}
                        notifiedAt={signoff.notified_at}
                        noticeHours={row.noticeHoursOverride ?? noticeHours[intervention] ?? null}
                        canSignOff={canSignOff}
                        isJagsStaff={isJagsStaff}
                        rejectionReason={signoff.rejectionReason ?? null}
                        signoffComment={signoff.signoffComment ?? null}
                        noticeWarning={
                          signoff.status === "pending" && row.plannedDate && (intervention === "H" || intervention === "W" || blockingCodes.has(intervention))
                            ? (() => {
                                const n = evaluateNotice(row.plannedDate, row.noticeHoursOverride ?? noticeHours[intervention] ?? 24, levels.find((l) => l.code === intervention)?.label ?? (intervention === "H" ? "Hold" : "Witness"));
                                return n.status === "short_notice" || n.status === "overdue" ? { status: n.status, message: n.message } : null;
                              })()
                            : null
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </ScrollRegion>
    </div>
  );
}
