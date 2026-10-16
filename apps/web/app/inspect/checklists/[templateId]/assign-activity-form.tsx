"use client";

import { useActionState, useRef } from "react";
import { assignActivityAction, type AssignActivityState } from "@/lib/checklists/assignment-actions";
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
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={formAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <input type="hidden" name="template_id" value={templateId} />
      <label className="flex flex-col gap-1 text-sm text-ink">
        <Tx>Assigned to</Tx>
        <select
          name="assignee_id"
          defaultValue={currentAssigneeId ?? ""}
          // Choosing a person saves straight away: no separate Save step to forget.
          onChange={() => formRef.current?.requestSubmit()}
          disabled={pending}
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
      <span className="min-h-11 text-sm sm:self-center" role="status" aria-live="polite">
        {pending ? <span className="text-muted"><Tx>Saving…</Tx></span> : state.saved && !state.error ? <span className="font-medium text-success"><Tx>✓ Saved. The person is notified.</Tx></span> : null}
      </span>
      {state.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
