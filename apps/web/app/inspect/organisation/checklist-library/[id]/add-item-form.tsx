"use client";

import { useActionState } from "react";
import { addLibraryItemAction, type LibraryItemFormState } from "@/lib/checklist-library/actions";
import { Button } from "@/components/ui/button";

const initialState: LibraryItemFormState = { error: null };

export function AddItemForm({ templateId }: { templateId: string }) {
  const [state, formAction, pending] = useActionState(addLibraryItemAction, initialState);

  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="template_id" value={templateId} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-muted">Item number</label>
          <input
            name="item_number"
            required
            placeholder="1"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted">Evidence type</label>
          <input
            name="evidence_type"
            placeholder="e.g. Photo, Measurement, Visual"
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Description</label>
        <textarea
          name="description"
          required
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-muted">Acceptance criteria</label>
        <textarea
          name="acceptance_criteria"
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input type="checkbox" name="is_mandatory" defaultChecked className="h-3.5 w-3.5" />
        Mandatory
      </label>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add item"}
      </Button>
    </form>
  );
}
