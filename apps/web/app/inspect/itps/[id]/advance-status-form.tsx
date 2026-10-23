"use client";

import { useActionState, useState } from "react";
import { ChecklistReviewAck } from "@/components/domain/checklist-review-ack";
import { advanceItpStatusAction, type AdvanceItpStatusState } from "@/lib/itps/actions";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: AdvanceItpStatusState = { error: null };

const LABEL: Record<"draft" | "under_review", { pending: string; idle: string; primary: boolean }> = {
  draft: { pending: "Submitting…", idle: "Submit for review", primary: false },
  under_review: { pending: "Approving…", idle: "Approve", primary: true },
};

/**
 * R79: advanceItpStatusAction now returns AdvanceItpStatusState (rather than void) so a configured
 * approval-workflow restriction has somewhere to surface — this replaces the previous plain
 * `<form action={advanceItpStatusAction}>` in the server component with useActionState, the same
 * pattern AddItemForm already uses for addItpItemAction.
 */
export function AdvanceStatusForm({
  itpId,
  fromStatus,
  requiresChecklistReview = false,
}: {
  itpId: string;
  fromStatus: "draft" | "under_review";
  /** Approving (under_review → approved) needs the reviewer to confirm they reviewed the checklist. */
  requiresChecklistReview?: boolean;
}) {
  const [state, formAction, pending] = useActionState(advanceItpStatusAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const copy = LABEL[fromStatus];
  const needsAck = requiresChecklistReview && fromStatus === "under_review";
  const [reviewed, setReviewed] = useState(false);

  return (
    <form onSubmit={keepValuesSubmit}>
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="from_status" value={fromStatus} />
      {needsAck && <ChecklistReviewAck checked={reviewed} onChange={setReviewed} />}
      <button
        type="submit"
        disabled={pending || (needsAck && !reviewed)}
        className={
          copy.primary
            ? "rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
            : "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-subtle disabled:opacity-50"
        }
      >
        {pending ? copy.pending : copy.idle}
      </button>
      {state.notice && <p role="status" className="mt-1 max-w-xs text-xs text-amber-700">{state.notice}</p>}
      {state.error && <p role="alert" className="mt-1 max-w-xs text-xs text-danger">{state.error}</p>}
    </form>
  );
}
