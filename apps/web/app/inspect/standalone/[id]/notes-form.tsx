"use client";

import { useActionState } from "react";
import { updateNotesAction, type UpdateNotesState } from "@/lib/standalone/actions";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(updateNotesAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  if (readOnly) {
    return <p className="whitespace-pre-wrap text-sm text-ink">{notes || "No notes recorded."}</p>;
  }

  return (
    <form onSubmit={keepValuesSubmit} className="space-y-2">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <textarea aria-label={tl("General notes about this assignment…")}
        name="notes"
        rows={6}
        defaultValue={notes ?? ""}
        placeholder={tl("General notes about this assignment…")}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      />
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <Button
        type="submit"
        disabled={pending}
        variant="outline" size="sm"
      >
        {pending ? "Saving…" : "Save notes"}
      </Button>
    </form>
  );
}
