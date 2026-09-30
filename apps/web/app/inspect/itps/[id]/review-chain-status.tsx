"use client";

import { useActionState } from "react";
import { approveReviewStepAction, type ApproveReviewStepState } from "@/lib/itps/review-chain-actions";
import type { ReviewProgressStep } from "@/lib/itps/review-chain";

const initialState: ApproveReviewStepState = { error: null };

export function ReviewChainStatus({
  itpId,
  steps,
  currentUserId,
  isAdminStaff,
}: {
  itpId: string;
  steps: ReviewProgressStep[];
  currentUserId: string;
  isAdminStaff: boolean;
}) {
  const [state, formAction, pending] = useActionState(approveReviewStepAction, initialState);
  const firstPending = steps.find((s) => s.status === "pending");
  const canActNow = !!firstPending && (isAdminStaff || firstPending.reviewerUserId === currentUserId);

  return (
    <div className="rounded-lg border border-info/40 bg-info/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-info">Review chain</p>
        {canActNow && (
          <form action={formAction}>
            <input type="hidden" name="itp_id" value={itpId} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md border border-info bg-surface px-3 py-1.5 text-xs font-medium text-info hover:bg-info/10 disabled:opacity-50"
            >
              {pending ? "Approving…" : `Approve review step ${(steps.findIndex((s) => s.id === firstPending!.id) ?? 0) + 1}`}
            </button>
          </form>
        )}
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-2">
        {steps.map((step, i) => {
          const tone =
            step.status === "approved" ? "success" : firstPending?.id === step.id ? "warning" : "neutral";
          return (
            <li key={step.id} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                  tone === "success"
                    ? "bg-success/10 text-success"
                    : tone === "warning"
                      ? "bg-warning/10 text-warning"
                      : "bg-muted/10 text-muted"
                }`}
              >
                {step.status === "approved" && "✓ "}
                {i + 1}. {step.reviewerName}
                {tone === "warning" ? " — reviewing now" : ""}
              </span>
              {i < steps.length - 1 && <span className="h-px w-4 bg-border" aria-hidden />}
            </li>
          );
        })}
      </ol>
      {state.error && <p className="mt-1.5 text-xs text-danger">{state.error}</p>}
    </div>
  );
}
