"use client";

import { useActionState, useId, useState } from "react";
import { reviewInspectionAction, type ReviewInspectionState } from "@/lib/checklists/review-actions";
import { MIN_REJECT_COMMENT_LENGTH } from "@/lib/checklists/review-logic";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

const initialState: ReviewInspectionState = { error: null };

/**
 * Reviewer approve / reject form (staff only; the page decides whether to render it). A rejection
 * needs a comment of at least MIN_REJECT_COMMENT_LENGTH characters. Approve asks for confirmation
 * because it is final until the inspection is re-opened.
 */
export function ReviewInspectionForm({ inspectionRecordId, hasPreviousReview }: { inspectionRecordId: string; hasPreviousReview: boolean }) {
  const [state, formAction, pending] = useActionState(reviewInspectionAction, initialState);
  const { gateSubmit, dialog } = useConfirm();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [comment, setComment] = useState("");
  const decisionId = useId();
  const commentId = useId();
  const hintId = useId();
  const errorId = useId();
  const rejecting = decision === "reject";
  const commentTooShort = rejecting && comment.trim().length < MIN_REJECT_COMMENT_LENGTH;

  return (
    <form
      action={formAction}
      className="space-y-3"
      onSubmit={gateSubmit(
        decision === "approve"
          ? {
              title: "Approve this inspection?",
              message: "The approval is recorded against your name. Re-opening the inspection clears it.",
              confirmLabel: "Approve",
            }
          : null
      )}
    >
      {dialog}
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <fieldset>
        <legend id={decisionId} className="text-sm font-medium text-ink">
          Decision
        </legend>
        <div className="mt-1 flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="radio" name="decision" value="approve" checked={decision === "approve"} onChange={() => setDecision("approve")} />
            Approve
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="decision" value="reject" checked={decision === "reject"} onChange={() => setDecision("reject")} />
            Reject
          </label>
        </div>
      </fieldset>
      <div>
        <label htmlFor={commentId} className="block text-sm font-medium text-ink">
          Review comment{rejecting ? <span className="text-danger"> *</span> : <span className="text-muted"> (optional)</span>}
        </label>
        <textarea
          id={commentId}
          name="comment"
          rows={3}
          maxLength={2000}
          required={rejecting}
          minLength={rejecting ? MIN_REJECT_COMMENT_LENGTH : undefined}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-describedby={`${hintId}${state.error ? ` ${errorId}` : ""}`}
          aria-invalid={state.error ? true : undefined}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <p id={hintId} className="mt-1 text-xs text-muted">
          {rejecting
            ? `A rejection needs a reason (at least ${MIN_REJECT_COMMENT_LENGTH} characters). The inspector is notified.`
            : "Optional note recorded with the approval."}
          {hasPreviousReview ? " This replaces the existing review decision." : ""}
        </p>
      </div>
      <Button type="submit" disabled={pending || commentTooShort} className={rejecting ? "bg-danger text-white hover:bg-danger/90" : undefined}>
        {pending ? "Saving…" : rejecting ? "Reject inspection" : "Approve inspection"}
      </Button>
      <div id={errorId} role="alert">
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
