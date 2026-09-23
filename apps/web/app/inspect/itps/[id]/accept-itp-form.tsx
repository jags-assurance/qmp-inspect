"use client";

import { useActionState } from "react";
import { acceptItpAction, type AcceptItpState } from "@/lib/itps/actions";

const initialState: AcceptItpState = { error: null };

/**
 * Real bug found live: the previous plain `<form action={acceptItpAction}>` (a bare server action
 * with no useActionState) had nowhere to show an error even after acceptItpAction was fixed to
 * return one — clicking "Accept ITP" while it was rejected server-side just silently did nothing.
 * Same fix pattern as AdvanceStatusForm's own doc comment for advanceItpStatusAction.
 */
export function AcceptItpForm({ itpId }: { itpId: string }) {
  const [state, formAction, pending] = useActionState(acceptItpAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="itp_id" value={itpId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-burgundy px-4 py-2 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
      >
        {pending ? "Accepting…" : "Accept ITP"}
      </button>
      {state.error && <p className="mt-1 max-w-xs text-xs text-danger">{state.error}</p>}
    </form>
  );
}
