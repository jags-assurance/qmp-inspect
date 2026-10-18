import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/badge";
import { InterventionSelect, type InterventionLevelOption } from "@/components/domain/intervention-select";
import { SignoffCell } from "@/components/domain/signoff-cell";
import { T } from "@/components/domain/t";
import { Tx } from "@/components/domain/tx";
import { evaluateNotice } from "@/lib/signoff/notice-check";
import { nextNeed, partyState, summariseActivity, type ActivityStatus, type ChecklistInspectionState, type PartyState } from "@/lib/itps/workspace";
import { buttonVariants } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { ActivityPanelItem } from "./activity-panel-item";
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
  /** The generated checklist's template id (for the link to the inspection), when one exists. */
  checklistTemplateId: string | null;
  inspectionState: ChecklistInspectionState;
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

const INSPECTION_LABEL: Record<ChecklistInspectionState, string> = {
  not_generated: "Checklist not created yet",
  not_started: "Inspection not started",
  in_progress: "Inspection in progress",
  pass: "Inspection complete: pass",
  fail: "Inspection complete: fail",
  partial: "Inspection complete: partial",
};

const INSPECTION_ACTION: Record<ChecklistInspectionState, string> = {
  not_generated: "",
  not_started: "Open the checklist to start the inspection",
  in_progress: "Continue the inspection",
  pass: "View the inspection",
  fail: "View the inspection",
  partial: "View the inspection",
};

/**
 * The default way to work an ITP section: a short, quiet list (one row per activity: number, title, how many
 * have signed, and at most one thing that needs attention), where tapping a row opens everything about the
 * activity in the shared side panel: what is needed now, what to check, who signs off, the checklist and its
 * inspection, documents and records. It is a different arrangement of the same components and rules as the
 * party matrix (ActivitySignoffGrid): InterventionSelect, SignoffCell, ItemControls and the evidence sections
 * are reused unchanged, so every permission, hold-point rule, notice check and audit trail is the matrix's.
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
        const waitingOn = row.partyCells
          .filter((c) => c.intervention && c.signoff?.status === "notified")
          .map((c) => c.party.name);
        const need = nextNeed(summary, waitingOn);
        const statusText = summary.required > 0 ? `${badge.label}: ${summary.done} of ${summary.required} signed` : badge.label;

        const rowNode = (
          <>
            <span className="doc-id mt-0.5 w-9 shrink-0 text-xs text-muted">{row.itemNumber}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{row.activity}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                {summary.status === "signed_off" ? (
                  <Badge tone="success"><Tx>Signed off</Tx></Badge>
                ) : (
                  <span>
                    <Tx>{badge.label}</Tx>
                    {summary.required > 0 && (
                      <span className="tabular-nums">
                        {" · "}{summary.done} <Tx>of</Tx> {summary.required} <Tx>signed</Tx>
                      </span>
                    )}
                  </span>
                )}
                {usedLevels.map((code) => (
                  <span
                    key={code}
                    title={levelLabel(code)}
                    className="inline-flex min-w-6 items-center justify-center rounded border border-control-border bg-surface px-1.5 text-xs font-semibold text-ink"
                  >
                    {code}
                    <span className="sr-only"> ({levelLabel(code)})</span>
                  </span>
                ))}
              </span>
            </span>
            {summary.yourSignoffs > 0 ? (
              <Badge tone="warning"><Tx>Your sign-off</Tx></Badge>
            ) : summary.holdOpen ? (
              <Badge tone="danger"><Tx>Hold open</Tx></Badge>
            ) : null}
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="mt-1 h-4 w-4 shrink-0 text-muted rtl:-scale-x-100">
              <path d="M7 4.5l5.5 5.5-5.5 5.5" />
            </svg>
          </>
        );

        return (
          <li key={row.itemId} id={`activity-${row.itemId}`} className="scroll-mt-[calc(var(--header-h)+5rem)]">
            <ActivityPanelItem
              id={row.itemId}
              label={`${row.itemNumber}: ${row.activity}`}
              title={`${row.itemNumber}  ${row.activity}`}
              description={statusText}
              row={rowNode}
            >
              <div className="mt-4 space-y-6">
                {/* 1. What is needed now, in one sentence */}
                <p
                  role="status"
                  className={cn(
                    "rounded-md border-s-4 bg-surface-subtle px-3 py-2.5 text-sm font-medium text-ink",
                    need.kind === "your_signoff" ? "border-warning" : need.kind === "hold" ? "border-danger" : need.kind === "done" ? "border-success" : "border-control-border"
                  )}
                >
                  <Tx>{need.text}</Tx>
                </p>

                {/* 2. What to check */}
                <section aria-label="What to check">
                  <h3 className="text-sm font-semibold text-ink"><Tx>What to check</Tx></h3>
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
                      <dl className="mt-2 space-y-2 text-sm">
                        {filled.map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs font-medium uppercase tracking-wide text-muted"><Tx>{label}</Tx></dt>
                            <dd className="text-ink [overflow-wrap:anywhere]">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  })()}
                </section>

                {/* 3. Who signs off */}
                <section aria-label="Party sign-offs">
                  <h3 className="text-sm font-semibold text-ink"><Tx>Who signs off</Tx></h3>
                  <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-surface">
                    {row.partyCells
                      .filter((c) => c.intervention || canEditContent)
                      .map(({ party, intervention, signoff, canSignOff }) => {
                        const state = partyState({ intervention, status: signoff?.status ?? null });
                        return (
                          <li key={party.id} className="space-y-2 px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{party.name}</p>
                                <p className="text-xs text-muted">
                                  {intervention ? levelLabel(intervention) : <Tx>No part in this activity</Tx>}
                                </p>
                              </div>
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
                          </li>
                        );
                      })}
                  </ul>
                </section>

                {/* 4. The checklist and its inspection */}
                {row.checklist && (
                  <section aria-label="Checklist and inspection">
                    <h3 className="text-sm font-semibold text-ink"><Tx>Checklist and inspection</Tx></h3>
                    <p className="mt-1 text-sm text-muted">
                      {row.checklist.number ? <span className="doc-id text-ink">{row.checklist.number}</span> : null}
                      {row.checklist.number ? " · " : ""}
                      <Tx>{INSPECTION_LABEL[row.inspectionState]}</Tx>
                    </p>
                    {row.checklistTemplateId ? (
                      <Link
                        href={`/inspect/checklists/${row.checklistTemplateId}`}
                        className={cn(buttonVariants({ variant: row.inspectionState === "not_started" || row.inspectionState === "in_progress" ? "primary" : "outline" }), "mt-2 w-full sm:w-auto")}
                      >
                        <Tx>{INSPECTION_ACTION[row.inspectionState]}</Tx> →
                      </Link>
                    ) : (
                      <p className="mt-1 text-sm text-muted"><Tx>The checklist is created when the ITP is approved.</Tx></p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <ActivityChecklistToggle label="Preview the checklist items" checklist={row.checklist} />
                    </div>
                  </section>
                )}

                {/* 5. Documents and records */}
                <section aria-label="Documents and records">
                  <h3 className="text-sm font-semibold text-ink"><Tx>Documents and records</Tx></h3>
                  <p className="mt-1 text-sm text-muted">
                    <Tx>List the documents expected for this activity (for example a mill certificate from the TPI / Lab), then attach each one from the Document Vault or upload it.</Tx>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">{row.evidenceNode}</div>
                  {row.evidenceCount !== null && row.evidenceCount === 0 && (
                    <p className="mt-2 text-sm text-ink"><span aria-hidden="true">! </span><Tx>No evidence has been attached yet.</Tx></p>
                  )}
                </section>

                {/* 6. Editing, for people who may */}
                {canEditContent && (
                  <Disclosure variant="card" summary={<Tx>Edit this activity</Tx>} bodyClassName="border-t border-border p-3">
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
                  </Disclosure>
                )}

                <p className="text-xs text-muted">
                  <Link href={`/inspect/projects/${projectId}/audit-log`} className="text-brand hover:underline">
                    <Tx>Activity history and audit log</Tx>
                  </Link>
                </p>
              </div>
            </ActivityPanelItem>
          </li>
        );
      })}
    </ul>
  );
}
