"use client";

import { useActionState, useState } from "react";
import { ChecklistReviewAck } from "@/components/domain/checklist-review-ack";
import { acceptItpAction, type AcceptItpState } from "@/lib/itps/actions";
import { Button } from "@/components/ui/button";

const initialState: AcceptItpState = { error: null };

/**
 * Real bug found live: the previous plain `<form action={acceptItpAction}>` (a bare server action
 * with no useActionState) had nowhere to show an error even after acceptItpAction was fixed to
 * return one — clicking "Accept ITP" while it was rejected server-side just silently did nothing.
 * Same fix pattern as AdvanceStatusForm's own doc comment for advanceItpStatusAction.
 */
export function AcceptItpForm({ itpId, requiresChecklistReview = false }: { itpId: string; requiresChecklistReview?: boolean }) {
  const [state, formAction, pending] = useActionState(acceptItpAction, initialState);
  const [reviewed, setReviewed] = useState(false);

  return (
    <form action={formAction}>
      <input type="hidden" name="itp_id" value={itpId} />
      {requiresChecklistReview && <ChecklistReviewAck checked={reviewed} onChange={setReviewed} />}
      <Button
        type="submit"
        disabled={pending || (requiresChecklistReview && !reviewed)}
        
      >
        {pending ? "Accepting…" : "Accept ITP"}
      </Button>
      {state.error && <p role="alert" className="mt-1 max-w-xs text-xs text-danger">{state.error}</p>}
    </form>
  );
}
