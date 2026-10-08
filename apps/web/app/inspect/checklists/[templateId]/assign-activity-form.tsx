"use client";

import { useActionState } from "react";
import { assignActivityAction, type AssignActivityState } from "@/lib/checklists/assignment-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

const initialState: AssignActivityState = { error: null };

/** Assign this activity to one specific person (or clear the assignment). */
export function AssignActivityForm({
  itpItemId,
  templateId,
  currentAssigneeId,
  options,
}: {
  itpItemId: string;
  templateId: string;
  currentAssigneeId: string | null;
  options: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignActivityAction, initialState);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input type="hidden" name="template_id" value={templateId} />
      <label className="flex flex-col gap-1 text-sm text-ink">
        <Tx>Assigned to</Tx>
        <select
          name="assignee_id"
          defaultValue={currentAssigneeId ?? ""}
          className="min-h-11 rounded-md border border-border bg-off-white px-3 py-2 text-sm"
        >
          <option value=""><Tx>Not assigned to a specific person</Tx></option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save assignment"}
      </Button>
      {state.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
