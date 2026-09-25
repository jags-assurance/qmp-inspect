import type { ReviewProgressStep } from "@/lib/itps/review-chain";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  notified: "Notified",
  signed_off: "Signed off",
  proceeded_no_response: "Proceeded (no response)",
};

const STATUS_TONE: Record<string, string> = {
  pending: "text-muted",
  notified: "text-warning",
  signed_off: "text-success",
  proceeded_no_response: "text-info",
};

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
  holderDetail,
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
  /** "Who holds what" across the whole ITP, person-wise: one entry per project party holding at
   *  least one intervention point, each with its own full list of points (activity, level, current
   *  notify/sign-off status) — not just a per-level count, per the round-table's own follow-up ask
   *  ("who will, how many, person wise detail, what intervention/notify/signoff, remaining in
   *  detail"). Each party collapses behind a native <details> disclosure to keep the page scannable
   *  on an ITP with many points, rather than always rendering every point open. */
  holderDetail: {
    partyName: string;
    points: { itemNumber: string; activity: string; levelCode: string; isBlocking: boolean; status: string; notifiedAt: string | null }[];
  }[];
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
      {holderDetail.length > 0 && (
        <div className={signoffTotal > 0 ? "mt-1.5" : "mt-3 border-t border-border pt-2.5"}>
          <p className="text-xs font-medium text-muted">Who holds what</p>
          <div className="mt-1 space-y-1">
            {holderDetail.map((holder) => {
              const remaining = holder.points.filter((p) => p.status !== "signed_off" && p.status !== "proceeded_no_response").length;
              const counts = new Map<string, number>();
              for (const p of holder.points) counts.set(p.levelCode, (counts.get(p.levelCode) ?? 0) + 1);
              return (
                <details key={holder.partyName} className="group rounded-md border border-border">
                  <summary className="cursor-pointer list-none px-2 py-1.5 text-xs marker:content-none">
                    <span className="text-ink">{holder.partyName}</span>{" "}
                    <span className="text-muted">
                      —{" "}
                      {[...counts.entries()].map(([code, count], i) => (
                        <span key={code}>
                          {i > 0 && ", "}
                          {code} ×{count}
                        </span>
                      ))}
                      {remaining > 0 && ` · ${remaining} still to notify/sign off`}
                    </span>
                    <span className="ml-1 text-muted group-open:hidden">▸</span>
                    <span className="ml-1 hidden text-muted group-open:inline">▾</span>
                  </summary>
                  <ul className="space-y-1 border-t border-border px-2 py-1.5">
                    {holder.points.map((p, i) => (
                      <li key={i} className="text-xs">
                        <span className="doc-id text-muted">{p.itemNumber}</span>{" "}
                        <span className="text-ink">{p.activity}</span>{" "}
                        <span className={p.isBlocking ? "font-medium text-burgundy" : "text-muted"}>({p.levelCode})</span> —{" "}
                        <span className={STATUS_TONE[p.status] ?? "text-muted"}>{STATUS_LABEL[p.status] ?? p.status}</span>
                        {p.status === "notified" && p.notifiedAt && (
                          <span className="text-muted"> ({new Date(p.notifiedAt).toLocaleDateString()})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
