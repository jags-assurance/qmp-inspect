"use client";

import { useActionState } from "react";
import { addChecklistItemAction, type AddChecklistItemState } from "@/lib/checklists/actions";

const initialState: AddChecklistItemState = { error: null };

export function AddChecklistItemForm({ templateId, disabledReason }: { templateId: string; disabledReason?: string | null }) {
  const [state, formAction, pending] = useActionState(addChecklistItemAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-border bg-off-white px-4 py-4">
      <fieldset disabled={!!disabledReason || pending} className="contents">
      <input type="hidden" name="template_id" value={templateId} />

      <div>
        <label htmlFor="add-item-number" className="block text-xs font-medium text-muted">Item no.</label>
        <input
          id="add-item-number"
          name="item_number"
          required
          placeholder="2"
          className="mt-1 w-20 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div className="min-w-64 flex-1">
        <label htmlFor="add-item-description" className="block text-xs font-medium text-muted">Description</label>
        <input
          id="add-item-description"
          name="description"
          required
          placeholder="e.g. Cable route matches latest approved drawing"
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      {/* Mandatory/optional shown as a pill toggle (visual only — same is_mandatory checkbox underneath). */}
      <label className="group flex cursor-pointer items-center gap-2 pb-0.5">
        <input type="checkbox" name="is_mandatory" defaultChecked className="peer sr-only" />
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors peer-checked:border-burgundy peer-checked:bg-burgundy/10 peer-checked:text-burgundy">
          Mandatory
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add item"}
      </button>
      </fieldset>
      {disabledReason && <p className="w-full text-xs text-muted">Adding items is disabled: {disabledReason}</p>}
      {state.error && <p className="w-full text-sm text-danger" role="alert">{state.error}</p>}
    </form>
  );
}
