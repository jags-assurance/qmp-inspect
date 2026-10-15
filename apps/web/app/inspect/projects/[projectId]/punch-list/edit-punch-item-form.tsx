"use client";

import { useActionState, useState } from "react";
import { updatePunchItemAction, type UpdatePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

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
      <Button type="button" onClick={() => setExpanded(true)} variant="link">
        <Tx>Edit assignment, due date, priority</Tx>
      </Button>
    );
  }

  const field = "mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy";
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <label className="text-xs font-medium text-ink">
        <Tx>Responsible party</Tx>
        <select name="responsible_party_id" defaultValue={current.responsible_party_id ?? ""} className={field}>
          <option value=""><Tx>Unassigned</Tx></option>
          {projectParties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="text-xs font-medium text-ink">
        <Tx>Due date</Tx>
        <input name="due_date" type="date" defaultValue={current.due_date ?? ""} className={field} />
      </label>
      <label className="text-xs font-medium text-ink">
        <Tx>Priority</Tx>
        <select name="priority" defaultValue={current.priority} className={field}>
          <option value="A"><Tx>A - critical</Tx></option>
          <option value="B"><Tx>B - major</Tx></option>
          <option value="C"><Tx>C - minor</Tx></option>
        </select>
      </label>
      <label className="text-xs font-medium text-ink">
        <Tx>Location</Tx>
        <input name="location" maxLength={200} defaultValue={current.location ?? ""} className={field} />
      </label>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        <Button type="button" onClick={() => setExpanded(false)} variant="outline" size="sm">
          <Tx>Cancel</Tx>
        </Button>
      </div>
    </form>
  );
}
