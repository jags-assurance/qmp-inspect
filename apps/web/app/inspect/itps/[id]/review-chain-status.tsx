"use client";

import { useActionState } from "react";
import { approveReviewStepAction, type ApproveReviewStepState, type ReviewProgressStep } from "@/lib/itps/review-chain";

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
    <div className="mt-3 rounded-md border border-info/40 bg-info/5 p-3">
      <p className="text-xs font-semibold text-info">Review chain</p>
      <ol className="mt-1.5 space-y-1 text-xs">
        {steps.map((step, i) => (
          <li key={step.id} className="flex items-center gap-2">
            <span className={step.status === "approved" ? "text-success" : firstPending?.id === step.id ? "text-warning" : "text-muted"}>
              {i + 1}. {step.reviewerName} —{" "}
              {step.status === "approved" ? "Approved" : firstPending?.id === step.id ? "Reviewing now" : "Waiting its turn"}
            </span>
          </li>
        ))}
      </ol>
      {canActNow && (
        <form action={formAction} className="mt-2">
          <input type="hidden" name="itp_id" value={itpId} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-info bg-surface px-3 py-1.5 text-xs font-medium text-info hover:bg-info/10 disabled:opacity-50"
          >
            {pending ? "Approving…" : `Approve review step ${(steps.findIndex((s) => s.id === firstPending!.id) ?? 0) + 1}`}
          </button>
          {state.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
        </form>
      )}
    </div>
  );
}
