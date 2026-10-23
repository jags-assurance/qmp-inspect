"use client";

import { useActionState } from "react";
import { reviewProposalAction, type ReviewProposalState } from "@/lib/itp-master/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: ReviewProposalState = { error: null };

// Mirrors the Save-progress/Close-NCR pattern in
// apps/web/app/inspect/ncrs/[id]/close-out-form.tsx: two submit buttons carry their own
// name="decision" value, so the server action reads formData.get("decision") directly — no client
// state needed to know which one was pressed.
export function ProposalReviewForm({ proposalId }: { proposalId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(reviewProposalAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const { askThenSubmit, dialog } = useConfirm();
  const confirmReject = askThenSubmit({
    title: "Reject this proposal?",
    message: "The reviewer notes will be recorded.",
    confirmLabel: "Reject",
    destructive: true,
  });

  return (
    <form onSubmit={keepValuesSubmit} className="mt-3 space-y-2">
      {dialog}
      <input type="hidden" name="proposal_id" value={proposalId} />

      <textarea aria-label={tl("Review notes (required if rejecting)…")}
        name="review_notes"
        rows={2}
        placeholder={tl("Review notes (required if rejecting)…")}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      />

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" name="decision" value="approve" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Approve"}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="reject"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={(e) => {
            const form = e.currentTarget.form;
            const notes = (form?.elements.namedItem("review_notes") as HTMLTextAreaElement | null)?.value.trim();
            if (!notes) {
              e.preventDefault();
              form?.reportValidity();
              (form?.elements.namedItem("review_notes") as HTMLTextAreaElement | null)?.focus();
              return;
            }
            confirmReject(e);
          }}
        >
          {pending ? "Saving…" : "Reject"}
        </Button>
      </div>
    </form>
  );
}
