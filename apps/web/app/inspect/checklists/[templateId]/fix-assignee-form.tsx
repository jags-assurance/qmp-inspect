"use client";

import { useActionState, useEffect, useState } from "react";
import { assignChecklistFixAction, type AssignFixState } from "@/lib/checklists/fix-assignment-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

const initialState: AssignFixState = { error: null };

/** "Who fixes this?" for a checklist item answered No. Online only: it is a plain server action, never queued offline. */
export function FixAssigneeForm({
  templateId,
  inspectionRecordId,
  checklistItemId,
  currentAssigneeId,
  options,
}: {
  templateId: string;
  inspectionRecordId: string;
  checklistItemId: string;
  currentAssigneeId: string | null;
  options: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignChecklistFixAction, initialState);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <input type="hidden" name="checklist_item_id" value={checklistItemId} />
      <label className="flex flex-col gap-1 text-xs font-medium text-ink">
        <Tx>Who fixes this?</Tx>
        <select
          name="assignee_id"
          defaultValue={currentAssigneeId ?? ""}
          className="min-h-11 rounded-md border border-border bg-surface px-3 py-2 text-base font-normal sm:text-sm"
        >
          <option value=""><Tx>Nobody yet</Tx></option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending || !online}>
        {pending ? "Saving…" : "Save"}
      </Button>
      {!online && <p className="text-xs text-muted"><Tx>Needs a connection.</Tx></p>}
      {state.error && (
        <p className="text-xs text-danger" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && <p className="text-xs text-success" role="status"><Tx>Saved.</Tx></p>}
    </form>
  );
}
