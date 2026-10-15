"use client";

import { useActionState } from "react";
import { approveItpRevisionAction, type ApproveRevisionState } from "@/lib/itps/actions";
import { Button } from "@/components/ui/button";

const initialState: ApproveRevisionState = { error: null };

/** Approves the latest revision of an issued ITP after an edit (re-approval; the editor can't self-approve). */
export function ApproveRevisionForm({ itpId, revision }: { itpId: string; revision: number }) {
  const [state, formAction, pending] = useActionState(approveItpRevisionAction, initialState);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="itp_id" value={itpId} />
      <Button
        type="submit"
        disabled={pending}
        size="sm"
      >
        {pending ? "Approving…" : `Approve revision ${revision}`}
      </Button>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
