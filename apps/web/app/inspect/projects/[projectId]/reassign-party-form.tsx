"use client";

import { useActionState, useState } from "react";
import { reassignSignoffPartyAction, type ReassignPartyState } from "@/lib/signoff/actions";

const initialState: ReassignPartyState = { error: null };

export function ReassignPartyForm({
  projectPartyId,
  eligibleUsers,
}: {
  projectPartyId: string;
  eligibleUsers: { id: string; full_name: string; email: string }[];
}) {
  const [state, formAction, pending] = useActionState(reassignSignoffPartyAction, initialState);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-burgundy hover:underline">
        Reassign
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="project_party_id" value={projectPartyId} />
      <select
        name="new_user_id"
        required
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
      >
        <option value="">— choose new user —</option>
        {eligibleUsers.map((u) => (
          <option key={u.id} value={u.id}>
            {u.full_name} ({u.email})
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="text-burgundy hover:underline disabled:opacity-50">
        {pending ? "Reassigning…" : "Confirm"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-muted hover:underline">
        Cancel
      </button>
      {state.error && <span className="text-danger">{state.error}</span>}
    </form>
  );
}
