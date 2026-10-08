"use client";

import { useActionState, useState } from "react";
import { updatePunchItemAction, type UpdatePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";

const initialState: UpdatePunchItemState = { error: null };

/** Small edit form (responsible party, due date, priority, location) for verifiers/staff. */
export function EditPunchItemForm({
  projectId,
  punchItemId,
  projectParties,
  current,
}: {
  projectId: string;
  punchItemId: string;
  projectParties: { id: string; name: string }[];
  current: { responsible_party_id: string | null; due_date: string | null; priority: string; location: string | null };
}) {
  const [state, formAction, pending] = useActionState(updatePunchItemAction, initialState);
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="min-h-11 text-sm font-medium text-burgundy hover:underline">
        Edit assignment, due date, priority
      </button>
    );
  }

  const field = "mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <label className="text-xs font-medium text-ink">
        Responsible party
        <select name="responsible_party_id" defaultValue={current.responsible_party_id ?? ""} className={field}>
          <option value="">Unassigned</option>
          {projectParties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-ink">
        Due date
        <input name="due_date" type="date" defaultValue={current.due_date ?? ""} className={field} />
      </label>
      <label className="text-xs font-medium text-ink">
        Priority
        <select name="priority" defaultValue={current.priority} className={field}>
          <option value="A">A - critical</option>
          <option value="B">B - major</option>
          <option value="C">C - minor</option>
        </select>
      </label>
      <label className="text-xs font-medium text-ink">
        Location
        <input name="location" maxLength={200} defaultValue={current.location ?? ""} className={field} />
      </label>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        <button type="button" onClick={() => setExpanded(false)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-off-white">
          Cancel
        </button>
      </div>
    </form>
  );
}
