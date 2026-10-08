"use client";

import { useActionState } from "react";
import { addPunchItemAction, type AddPunchItemState } from "@/lib/standalone/actions";
import { FormField } from "@/components/ui/form-field";

const initialState: AddPunchItemState = { error: null };

export function AddPunchItemForm({ assignmentId }: { assignmentId: string }) {
  const [state, formAction, pending] = useActionState(addPunchItemAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-border bg-off-white px-4 py-3">
      <input type="hidden" name="assignment_id" value={assignmentId} />

      <div className="min-w-48 flex-1">
        <FormField label="Description">
          <input
          name="description"
          required
          placeholder="What needs fixing…"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add punch item"}
      </button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
