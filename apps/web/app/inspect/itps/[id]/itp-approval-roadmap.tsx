import type { ReviewProgressStep } from "@/lib/itps/review-chain";

/**
 * The round-table ask: "a separate roadmap for permission and approval — accept, who will approve,
 * what stage" — distinct from the existing Completion Roadmap (/inspect/itps/[id]/status, which
 * only tracks field-execution evidence: checklists/measurements/documents). This tracks the
 * DOCUMENT's own lifecycle instead: Draft -> Submitted -> (review chain, if configured) -> Approved
 * -> Client accepted, each stage showing who's actually responsible for it and, once past it,
 * who/when it happened — plus a compact H/W/R/S intervention-grid completion figure, since that's
 * the other "roadmap tracking" the request asked to fold in here. Purely presentational; every
 * action a viewer can actually take (Approve, the review-chain "Approve step" button, Accept) still
 * lives in its own existing button/form elsewhere on this page — this is the map, not the controls.
 */
export function ItpApprovalRoadmap({
  status,
  reviewSteps,
  approvedByName,
  approvedAt,
  assignedAcceptorName,
  clientAcceptedByName,
  clientAcceptedAt,
  signoffTotal,
  signoffComplete,
  holderSummary,
}: {
  status: "draft" | "under_review" | "approved" | "client_accepted";
  reviewSteps: ReviewProgressStep[];
  approvedByName: string | null;
  approvedAt: string | null;
  /** Name of this ITP's assigned acceptor, or null when acceptance is open to any linked client party. */
  assignedAcceptorName: string | null;
  clientAcceptedByName: string | null;
  clientAcceptedAt: string | null;
  signoffTotal: number;
  signoffComplete: number;
  /** "Who holds what" across the whole ITP — one entry per project party that holds at least one
   *  intervention cell, with a count per level code. Rounds out the roadmap's approve/accept names
   *  with who's actually holding a point on this document. */
  holderSummary: { partyName: string; levels: { code: string; count: number; isBlocking: boolean }[] }[];
}) {
  const pastDraft = status !== "draft";
  const pastReview = status === "approved" || status === "client_accepted";
  const isAccepted = status === "client_accepted";

  const stages: { key: string; label: string; done: boolean; current: boolean; detail: string | null }[] = [
    { key: "draft", label: "Draft", done: pastDraft, current: status === "draft", detail: null },
    {
      key: "submitted",
      label: "Submitted for review",
      done: pastDraft,
      current: false,
      detail: null,
    },
    {
      key: "approved",
      label: "Approved",
      done: pastReview,
      current: status === "under_review",
      detail: pastReview && approvedByName ? `${approvedByName}${approvedAt ? ` · ${new Date(approvedAt).toLocaleDateString()}` : ""}` : null,
    },
    {
      key: "accepted",
      label: "Client accepted",
      done: isAccepted,
      current: status === "approved",
      detail: isAccepted
        ? `${clientAcceptedByName ?? "Client"}${clientAcceptedAt ? ` · ${new Date(clientAcceptedAt).toLocaleDateString()}` : ""}`
        : assignedAcceptorName
          ? `Assigned to ${assignedAcceptorName}`
          : "Open to any linked client party",
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Approval &amp; acceptance roadmap</h2>
      <ol className="mt-3 space-y-2.5">
        {stages.map((stage) => (
          <li key={stage.key} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                stage.done
                  ? "bg-success text-white"
                  : stage.current
                    ? "border-2 border-warning bg-surface text-warning"
                    : "border border-border bg-off-white text-muted"
              }`}
              aria-hidden
            >
              {stage.done ? "✓" : ""}
            </span>
            <div>
              <p className={`text-sm ${stage.done || stage.current ? "font-medium text-ink" : "text-muted"}`}>
                {stage.label}
                {stage.current && <span className="ml-1.5 text-xs font-normal text-warning">— current stage</span>}
              </p>
              {stage.detail && <p className="text-xs text-muted">{stage.detail}</p>}
              {/* Full per-reviewer detail (with the "Approve step" action) lives in ReviewChainStatus
                  below the button row — this is just enough of a summary to place the review chain
                  on the map without duplicating its actionable UI. */}
              {stage.key === "approved" && reviewSteps.length > 0 && (
                <p className="text-xs text-muted">
                  Review chain: {reviewSteps.filter((s) => s.status === "approved").length} of {reviewSteps.length} steps approved
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {signoffTotal > 0 && (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted">
          Intervention grid (H/W/R/S): {signoffComplete} of {signoffTotal} sign-off points complete
        </p>
      )}
      {holderSummary.length > 0 && (
        <div className={signoffTotal > 0 ? "mt-1.5" : "mt-3 border-t border-border pt-2.5"}>
          <p className="text-xs font-medium text-muted">Who holds what</p>
          <ul className="mt-1 space-y-0.5">
            {holderSummary.map((holder) => (
              <li key={holder.partyName} className="text-xs text-muted">
                <span className="text-ink">{holder.partyName}</span> —{" "}
                {holder.levels.map((l, i) => (
                  <span key={l.code}>
                    {i > 0 && ", "}
                    <span className={l.isBlocking ? "font-medium text-burgundy" : undefined}>
                      {l.code} ×{l.count}
                    </span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
