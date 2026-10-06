"use client";

import { useActionState } from "react";
import { approveItpRevisionAction, type ApproveRevisionState } from "@/lib/itps/actions";

const initialState: ApproveRevisionState = { error: null };

/** Approves the latest revision of an issued ITP after an edit (re-approval; the editor can't self-approve). */
export function ApproveRevisionForm({ itpId, revision }: { itpId: string; revision: number }) {
  const [state, formAction, pending] = useActionState(approveItpRevisionAction, initialState);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="itp_id" value={itpId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
      >
        {pending ? "Approving…" : `Approve revision ${revision}`}
      </button>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
