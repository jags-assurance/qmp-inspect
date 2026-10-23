"use client";

import { useActionState, useState } from "react";
import { reassignSignoffPartyAction, type ReassignPartyState } from "@/lib/signoff/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: ReassignPartyState = { error: null };

export function ReassignPartyForm({
  projectPartyId,
  eligibleUsers,
}: {
  projectPartyId: string;
  eligibleUsers: { id: string; full_name: string; email: string }[];
}) {
  const [state, formAction, pending] = useActionState(reassignSignoffPartyAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} variant="link">
        <Tx>Reassign</Tx>
      </Button>
    );
  }

  return (
    <form onSubmit={keepValuesSubmit} className="flex items-center gap-1.5">
      <input type="hidden" name="project_party_id" value={projectPartyId} />
      <select
        name="new_user_id"
        required
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
      >
        <option value=""><Tx>— choose new user —</Tx></option>
        {eligibleUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name} ({u.email})
          </option>
        ))}
      </select>
      <Button type="submit" disabled={pending} variant="link">
        {pending ? "Reassigning…" : "Confirm"}
      </Button>
      <Button type="button" onClick={() => setOpen(false)} variant="link-muted">
        <Tx>Cancel</Tx>
      </Button>
      {state.error && <span className="text-danger">{state.error}</span>}
    </form>
  );
}
