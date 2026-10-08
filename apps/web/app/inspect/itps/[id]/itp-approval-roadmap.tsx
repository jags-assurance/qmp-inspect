import type { ReviewProgressStep } from "@/lib/itps/review-chain";
import { T } from "@/components/domain/t";

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
      detail: pastReview && approvedByName ? `${approvedByName}${approvedAt ? ` · ${new Date(approvedAt).toLocaleDateString("en-GB")}` : ""}` : null,
    },
    {
      key: "accepted",
      label: "Client accepted",
      done: isAccepted,
      current: status === "approved",
      detail: isAccepted
        ? `${clientAcceptedByName ?? "Client"}${clientAcceptedAt ? ` · ${new Date(clientAcceptedAt).toLocaleDateString("en-GB")}` : ""}`
        : assignedAcceptorName
          ? `Assigned to ${assignedAcceptorName}`
          : "Open to any linked client party",
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink"><T>Approval &amp; acceptance roadmap</T></h3>
      <ol className="mt-3 space-y-2.5">
        {stages.map((stage) => (
          <li key={stage.key} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
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
            <div className="min-w-0">
              <p className={`text-sm ${stage.done || stage.current ? "font-medium text-ink" : "text-muted"}`}>
                {stage.label}
                {stage.current && <span className="ms-1.5 text-xs font-normal text-warning"><T>— current stage</T></span>}
              </p>
              {stage.detail && <p className="text-xs text-muted">{stage.detail}</p>}
              {/* Full per-reviewer detail (with the "Approve step" action) lives in ReviewChainStatus
                  below the button row — this is just enough of a summary to place the review chain
                  on the map without duplicating its actionable UI. */}
              {stage.key === "approved" && reviewSteps.length > 0 && (
                <p className="text-xs text-muted">
                  <T>Review chain:</T> {reviewSteps.filter((s) => s.status === "approved").length} <T>of</T> {reviewSteps.length} <T>steps approved</T>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {signoffTotal > 0 && (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted">
          <T>Intervention points:</T> {signoffComplete} <T>of</T> {signoffTotal} <T>signed off — details in section 3 below</T>
        </p>
      )}
    </div>
  );
}
