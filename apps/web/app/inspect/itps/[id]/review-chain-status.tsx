"use client";

import { useActionState, useState } from "react";
import { ChecklistReviewAck } from "@/components/domain/checklist-review-ack";
import {
  approveReviewStepAction,
  reassignReviewStepAction,
  type ApproveReviewStepState,
  type ReassignReviewStepState,
} from "@/lib/itps/review-chain-actions";
import type { ReviewProgressStep } from "@/lib/itps/review-chain";
import { FormField } from "@/components/ui/form-field";

const initialState: ApproveReviewStepState = { error: null };
const initialReassignState: ReassignReviewStepState = { error: null };

export function ReviewChainStatus({
  itpId,
  steps,
  currentUserId,
  isAdminStaff,
  requiresChecklistReview = false,
  reassignOptions = [],
}: {
  requiresChecklistReview?: boolean;
  /** Admin only: active JAGS staff a pending step can be reassigned to. Empty hides the control. */
  reassignOptions?: { id: string; name: string }[];
  itpId: string;
  steps: ReviewProgressStep[];
  currentUserId: string;
  isAdminStaff: boolean;
}) {
  const [state, formAction, pending] = useActionState(approveReviewStepAction, initialState);
  const [reassignState, reassignAction, reassigning] = useActionState(reassignReviewStepAction, initialReassignState);
  const [reviewed, setReviewed] = useState(false);
  const firstPending = steps.find((s) => s.status === "pending");
  const canActNow = !!firstPending && (isAdminStaff || firstPending.reviewerUserId === currentUserId);

  return (
    <div className="rounded-lg border border-info/40 bg-info/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-info">Review chain</p>
        {canActNow && (
          <form action={formAction}>
            <input type="hidden" name="itp_id" value={itpId} />
            {requiresChecklistReview && <ChecklistReviewAck checked={reviewed} onChange={setReviewed} />}
            <button
              type="submit"
              disabled={pending || (requiresChecklistReview && !reviewed)}
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
      {isAdminStaff && firstPending && reassignOptions.length > 0 && (
        <form action={reassignAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-info/20 pt-3">
          <input type="hidden" name="itp_id" value={itpId} />
          <input type="hidden" name="step_id" value={firstPending.id} />
          <div>
            <FormField label={<>Reviewer is unavailable? Hand step {steps.findIndex((s) => s.id === firstPending.id) + 1} to</>}>
              <select
              name="new_reviewer_user_id"
              required
              defaultValue=""
              className="mt-1 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy"
            >
              <option value="" disabled>
                Choose a reviewer
              </option>
              {reassignOptions
                .filter((o) => o.id !== firstPending.reviewerUserId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
            </FormField>
          </div>
          <button
            type="submit"
            disabled={reassigning}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-off-white disabled:opacity-50"
          >
            {reassigning ? "Reassigning…" : "Reassign"}
          </button>
          {reassignState.error && (
            <p role="alert" className="w-full text-xs text-danger">
              {reassignState.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
