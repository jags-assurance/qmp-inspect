"use client";

import { useActionState, useState } from "react";
import { updatePunchItemAction, type UpdatePunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <Button type="button" onClick={() => setExpanded(true)} variant="link">
        <Tx>Edit assignment, due date, priority</Tx>
      </Button>
    );
  }

  const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-surface px-3 py-2 text-sm min-h-11";
  return (
    <form onSubmit={keepValuesSubmit} className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5 md:grid-cols-2">
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
        <input name="due_date" type="date" max="9999-12-31" defaultValue={current.due_date ?? ""} className={field} />
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
      {state.error && <p role="alert" className="text-sm text-danger md:col-span-2">{state.error}</p>}
      <StickyActionBar inCard className="md:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        <Button type="button" onClick={() => setExpanded(false)} variant="outline">
          <Tx>Cancel</Tx>
        </Button>
      </StickyActionBar>
    </form>
  );
}
