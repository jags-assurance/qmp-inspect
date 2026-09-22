import { Badge } from "@/components/ui/badge";
import { InterventionSelect, type InterventionLevelOption } from "@/components/domain/intervention-select";
import { SignoffCell } from "@/components/domain/signoff-cell";
import type { SignoffStatus } from "@/lib/signoff/db-types";
import type { InterventionLevel } from "@jags/shared-types";
import { cn } from "@/lib/cn";

export interface PartySignoffCell {
  party: { id: string; name: string; user_id: string | null };
  intervention: InterventionLevel | null;
  signoff: { id: string; status: SignoffStatus; notified_at: string | null } | null;
  /** Whether the CURRENT user may sign off for this specific party — see canSignOffForParty in lib/signoff/actions.ts. */
  canSignOff: boolean;
}

export interface GridRow {
  itemId: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  evidenceLabel: string;
  disciplineCode: string | null;
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
  if (intervention) return "bg-off-white/60";
  return "bg-transparent";
}

/**
 * One section's H/W/R/S sign-off grid: rows = activities, columns = project parties, matching the
 * literal grid layout real client ITP reference documents use (one column per inspecting party).
 * Replaces the previous per-activity ActivitySignoffCard "chain of chips" layout — every action and
 * business rule InterventionSelect and SignoffCell enforce is unchanged, this only changes how they
 * are composed (a real <table> instead of a wrapped flex row of cards).
 *
 * Deliberately wide: `overflow-x-auto` here (not on the whole page) lets a project with several
 * parties scroll horizontally without breaking this app's documented no-page-scroll-at-phone-width
 * convention elsewhere — see components/ui/data-table.tsx for the same pattern.
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
}) {
  if (rows.length === 0) {
    return <p className="px-3 py-6 text-center text-muted">No activities in this section yet.</p>;
  }

  if (parties.length === 0) {
    return <p className="px-3 py-6 text-center text-muted">No project parties configured for this project yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-off-white/60 text-left text-xs text-muted">
            <th className="sticky left-0 z-10 min-w-[240px] bg-off-white/60 px-4 py-2 font-medium">Activity</th>
            {parties.map((party) => (
              <th key={party.id} className="min-w-28 px-3 py-2 text-center font-medium">
                <span className="block max-w-32 truncate" title={party.name}>
                  {party.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemId} className="border-b border-border align-top last:border-0">
              <td className="sticky left-0 z-10 bg-surface px-4 py-3">
                <p className="text-sm text-ink">
                  <span className="doc-id mr-1.5 text-muted">{row.itemNumber}</span>
                  {row.activity}
                </p>
                {row.acceptanceCriteria && <p className="mt-0.5 text-xs text-muted">{row.acceptanceCriteria}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{row.evidenceLabel}</Badge>
                  {row.disciplineCode && <Badge tone="neutral">{row.disciplineCode}</Badge>}
                </div>
              </td>
              {row.partyCells.map(({ party, intervention, signoff, canSignOff }) => (
                <td
                  key={party.id}
                  className={cn(
                    "border-l border-border/60 px-3 py-3 text-center",
                    cellToneClass(intervention, !!intervention && blockingCodes.has(intervention))
                  )}
                >
                  <div className="flex flex-col items-center gap-1">
                    <InterventionSelect
                      itpId={itpId}
                      itpItemId={row.itemId}
                      projectPartyId={party.id}
                      value={intervention}
                      editable={canEditContent}
                      levels={levels}
                    />
                    {intervention && signoff && (
                      <SignoffCell
                        progressId={signoff.id}
                        isBlocking={blockingCodes.has(intervention)}
                        status={signoff.status}
                        notifiedAt={signoff.notified_at}
                        noticeHours={noticeHours[intervention] ?? null}
                        canSignOff={canSignOff}
                        isJagsStaff={isJagsStaff}
                      />
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
