"use client";

import { useActionState } from "react";
import { advanceItpStatusAction, type AdvanceItpStatusState } from "@/lib/itps/actions";

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
export function AdvanceStatusForm({ itpId, fromStatus }: { itpId: string; fromStatus: "draft" | "under_review" }) {
  const [state, formAction, pending] = useActionState(advanceItpStatusAction, initialState);
  const copy = LABEL[fromStatus];

  return (
    <form action={formAction}>
      <input type="hidden" name="itp_id" value={itpId} />
      <input type="hidden" name="from_status" value={fromStatus} />
      <button
        type="submit"
        disabled={pending}
        className={
          copy.primary
            ? "rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
            : "rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
        }
      >
        {pending ? copy.pending : copy.idle}
      </button>
      {state.error && <p className="mt-1 max-w-xs text-xs text-danger">{state.error}</p>}
    </form>
  );
}
