"use client";

import { useActionState } from "react";
import { updateNotesAction, type UpdateNotesState } from "@/lib/standalone/actions";

const initialState: UpdateNotesState = { error: null };

export function NotesForm({
  assignmentId,
  notes,
  readOnly,
}: {
  assignmentId: string;
  notes: string | null;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateNotesAction, initialState);

  if (readOnly) {
    return <p className="whitespace-pre-wrap text-sm text-ink">{notes || "No notes recorded."}</p>;
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <textarea
        name="notes"
        rows={6}
        defaultValue={notes ?? ""}
        placeholder="General notes about this assignment…"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      />
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save notes"}
      </button>
    </form>
  );
}
