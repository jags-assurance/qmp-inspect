"use client";

import { useActionState } from "react";
import { removeStaffGrantAction, type StaffAccessState } from "@/lib/staff-access/actions";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: StaffAccessState = { error: null };

export function RemoveGrantButton({ grantId }: { grantId: string }) {
  const [state, formAction, pending] = useActionState(removeStaffGrantAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="inline">
      <input type="hidden" name="grant_id" value={grantId} />
      <Button
        type="submit"
        disabled={pending}
        variant="link-danger" size="sm"
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {state.error && <span className="ms-2 text-xs text-danger">{state.error}</span>}
    </form>
  );
}
