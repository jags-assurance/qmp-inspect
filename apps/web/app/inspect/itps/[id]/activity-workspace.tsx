import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/badge";
import { InterventionSelect, type InterventionLevelOption } from "@/components/domain/intervention-select";
import { SignoffCell } from "@/components/domain/signoff-cell";
import { T } from "@/components/domain/t";
import { Tx } from "@/components/domain/tx";
import { evaluateNotice } from "@/lib/signoff/notice-check";
import { partyState, summariseActivity, type ActivityStatus, type PartyState } from "@/lib/itps/workspace";
import { cn } from "@/lib/cn";
import { ItemControls } from "./item-controls";
import { ActivityChecklistToggle } from "./activity-checklist-toggle";
import type { GridRow } from "./activity-signoff-grid";

export interface WorkspaceRow extends GridRow {
  /** Expected records / measurements / evidence documents blocks for this activity (the existing sections). */
  evidenceNode: ReactNode;
  /** Evidence attached so far, for the activity's evidence type: documents (type 2), measurements (type 3), else null. */
  evidenceCount: number | null;
  recordsExpected: number;
  recordsReceived: number;
}

const STATUS_BADGE: Record<ActivityStatus, { tone: Tone; label: string }> = {
  signed_off: { tone: "success", label: "Signed off" },
  in_progress: { tone: "info", label: "In progress" },
  not_started: { tone: "neutral", label: "Not started" },
  no_signoffs: { tone: "neutral", label: "No sign-offs set" },
};

const PARTY_STATE_LABEL: Record<PartyState, string> = {
  not_required: "Not required",
  pending: "Pending",
  notified: "Notified",
  signed_off: "Signed off",
  proceeded: "Proceeded (no response)",
};

const PARTY_STATE_ICON: Record<PartyState, string> = {
  not_required: "–",
  pending: "○",
  notified: "◔",
  signed_off: "✓",
  proceeded: "→",
};

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0 text-muted transition-transform group-open/activity:rotate-90 motion-reduce:transition-none rtl:-scale-x-100 rtl:group-open/activity:rotate-[-90deg]"
    >
      <path d="M7 4.5l5.5 5.5-5.5 5.5" />
    </svg>
  );
}

/**
 * The default way to work an ITP section: one compact row per activity (number, short title, status, the
 * levels that apply, "n of m signed", and anything waiting on the viewer), expanding in place to the
 * requirements, who must do what, the checklist, and records/evidence. It is a different arrangement of the
 * same components and rules as the party matrix (ActivitySignoffGrid): InterventionSelect, SignoffCell,
 * ItemControls and the evidence sections are reused unchanged, so every permission, hold-point rule, notice
 * check and audit trail is exactly what the matrix uses.
 */
export function ActivityWorkspace({
  itpId,
  projectId,
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
  projectId: string;
  rows: WorkspaceRow[];
  parties: { id: string; name: string }[];
  canEditContent: boolean;
  isJagsStaff: boolean;
  noticeHours: Record<string, number>;
  levels: InterventionLevelOption[];
  blockingCodes: Set<string>;
  disciplines: { id: string; code: string; name: string }[];
  isIssued: boolean;
}) {
  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted"><T>No activities in this section yet.</T></p>;
  }
  if (parties.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted"><T>No project parties configured for this project yet.</T></p>;
  }
  const levelLabel = (code: string) => levels.find((l) => l.code === code)?.label ?? code;

  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => {
        const summary = summariseActivity(
          row.partyCells.map((c) => ({
            intervention: c.intervention,
            status: c.signoff?.status ?? null,
            isBlocking: !!c.intervention && blockingCodes.has(c.intervention),
            canSignOff: c.canSignOff,
          }))
        );
        const badge = STATUS_BADGE[summary.status];
        const usedLevels = [...new Set(row.partyCells.map((c) => c.intervention).filter((c): c is string => !!c))];
        const evidenceMissing = row.evidenceCount !== null && row.evidenceCount === 0;
        const recordsOutstanding = row.recordsExpected - row.recordsReceived;
        return (
          <li key={row.itemId} id={`activity-${row.itemId}`} className="scroll-mt-[calc(var(--header-h)+5rem)]">
            <details data-activity className="group/activity">
              <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 hover:bg-surface-subtle sm:px-4 [&::-webkit-details-marker]:hidden [@media(pointer:coarse)]:min-h-11">
                <Chevron />
                <span className="doc-id mt-0.5 shrink-0 text-xs text-muted">{row.itemNumber}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{row.activity}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={badge.tone}><Tx>{badge.label}</Tx></Badge>
                    {summary.required > 0 && (
                      <span className="text-xs tabular-nums text-muted">
                        {summary.done} <Tx>of</Tx> {summary.required} <Tx>signed</Tx>
                      </span>
                    )}
                    {usedLevels.map((code) => (
                      <span
                        key={code}
                        title={levelLabel(code)}
                        className={cn(
                          "inline-flex min-w-6 items-center justify-center rounded border px-1.5 text-xs font-semibold",
                          blockingCodes.has(code) ? "border-burgundy/50 bg-burgundy/5 text-burgundy" : "border-control-border bg-surface text-ink"
                        )}
                      >
                        {code}
                        <span className="sr-only"> ({levelLabel(code)})</span>
                      </span>
                    ))}
                    {summary.holdOpen && <Badge tone="danger"><Tx>Hold open</Tx></Badge>}
                    {summary.yourSignoffs > 0 && <Badge tone="warning"><Tx>Your sign-off</Tx></Badge>}
                    {summary.yourSignoffs === 0 && isJagsStaff && summary.pending > 0 && <Badge tone="gold"><Tx>To notify:</Tx> {summary.pending}</Badge>}
                    {row.checklist && (
                      <span className="text-xs text-muted">
                        <Tx>Checklist</Tx>
                      </span>
                    )}
                    {evidenceMissing && <Badge tone="warning"><Tx>Evidence missing</Tx></Badge>}
                    {row.evidenceCount !== null && row.evidenceCount > 0 && (
                      <span className="text-xs text-muted">
                        <Tx>Evidence:</Tx> {row.evidenceCount}
                      </span>
                    )}
                    {row.recordsExpected > 0 && (
                      <span className="text-xs text-muted">
                        <Tx>Records:</Tx> {row.recordsReceived}/{row.recordsExpected}
                        {recordsOutstanding > 0 && <span className="sr-only"> (<Tx>outstanding</Tx>)</span>}
                      </span>
                    )}
                    {row.disciplineCode && <span className="text-xs text-muted">{row.disciplineCode}</span>}
                  </span>
                </span>
              </summary>

              <div className="space-y-4 border-t border-border bg-surface-subtle/40 px-3 py-3 sm:px-4 sm:py-4">
                {/* Requirements */}
                <section aria-label="Requirements">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Inspection requirements</Tx></h3>
                  {(() => {
                    const fields: [string, string | null | undefined][] = [
                      ["Acceptance", row.acceptanceCriteria],
                      ["Reference", row.referenceSpec],
                      ["Method", row.method],
                      ["Frequency", row.frequency],
                      ["Planned", row.plannedDate],
                      ["Notice", row.noticeHoursOverride != null ? `${row.noticeHoursOverride}h` : null],
                    ];
                    const filled = fields.filter(([, v]) => v && String(v).trim());
                    return filled.length === 0 ? (
                      <p className="mt-1 text-sm text-muted"><Tx>No requirements recorded for this activity.</Tx></p>
                    ) : (
                      <dl className="mt-1 grid max-w-3xl gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                        {filled.map(([label, value]) => (
                          <div key={label} className="contents">
                            <dt className="font-medium text-ink"><Tx>{label}</Tx></dt>
                            <dd className="text-muted [overflow-wrap:anywhere]">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  })()}
                  {canEditContent && (
                    <div className="mt-3 border-t border-border pt-3">
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
                    </div>
                  )}
                </section>

                {/* Who must do what */}
                <section aria-label="Party sign-offs">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Who signs off</Tx></h3>
                  <ul className="mt-1 divide-y divide-border rounded-md border border-border bg-surface">
                    {row.partyCells
                      .filter((c) => c.intervention || canEditContent)
                      .map(({ party, intervention, signoff, canSignOff }) => {
                        const state = partyState({ intervention, status: signoff?.status ?? null });
                        return (
                          <li key={party.id} className="grid items-start gap-x-4 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)]">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-ink" title={party.name}>{party.name}</p>
                              <p className="text-xs text-muted">
                                {intervention ? levelLabel(intervention) : <Tx>No part in this activity</Tx>}
                              </p>
                            </div>
                            <div>
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
                            <div className="min-w-0">
                              {intervention && signoff ? (
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
                                          const n = evaluateNotice(row.plannedDate, row.noticeHoursOverride ?? noticeHours[intervention] ?? 24, levelLabel(intervention));
                                          return n.status === "short_notice" || n.status === "overdue" ? { status: n.status, message: n.message } : null;
                                        })()
                                      : null
                                  }
                                />
                              ) : (
                                <p className="text-xs text-muted">
                                  <span aria-hidden="true">{PARTY_STATE_ICON[state]} </span>
                                  <Tx>{PARTY_STATE_LABEL[state]}</Tx>
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </section>

                {/* Checklist */}
                {row.checklist && (
                  <section aria-label="Checklist">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Checklist</Tx></h3>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <ActivityChecklistToggle label={row.evidenceLabel} checklist={row.checklist} />
                    </div>
                  </section>
                )}

                {/* Records and evidence */}
                <section aria-label="Records and evidence">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted"><Tx>Records and evidence</Tx></h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">{row.evidenceNode}</div>
                </section>

                <p className="text-xs text-muted">
                  <Link href={`/inspect/projects/${projectId}/audit-log`} className="text-brand hover:underline">
                    <Tx>Activity history and audit log</Tx>
                  </Link>
                </p>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
