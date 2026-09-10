"use client";

import { useActionState } from "react";
import { removeStaffGrantAction, type StaffAccessState } from "@/lib/staff-access/actions";

const initialState: StaffAccessState = { error: null };

export function RemoveGrantButton({ grantId }: { grantId: string }) {
  const [state, formAction, pending] = useActionState(removeStaffGrantAction, initialState);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="grant_id" value={grantId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-danger hover:underline disabled:opacity-50"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {state.error && <span className="ml-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
