"use client";

import { useActionState, useState } from "react";
import { addChecklistItemAction, type AddChecklistItemState } from "@/lib/checklists/actions";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: AddChecklistItemState = { error: null };

export function AddChecklistItemForm({ templateId, disabledReason }: { templateId: string; disabledReason?: string | null }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addChecklistItemAction, initialState);
  const [numeric, setNumeric] = useState(false);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 border-t border-border bg-off-white px-4 py-4">
      <fieldset disabled={!!disabledReason || pending} className="contents">
      <input type="hidden" name="template_id" value={templateId} />

      <div>
        <FormField label="Item no.">
          <input
          name="item_number"
          required
          placeholder="2"
          className="mt-1 w-20 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <div className="w-full sm:min-w-64 flex-1">
        <FormField label="Description">
          <input
          name="description"
          required
          placeholder={tl("e.g. Cable route matches latest approved drawing")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      {/* Mandatory/optional shown as a pill toggle (visual only — same is_mandatory checkbox underneath). */}
      <label className="group flex cursor-pointer items-center gap-2 pb-0.5">
        <input type="checkbox" name="is_mandatory" defaultChecked className="peer sr-only" />
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors peer-checked:border-burgundy peer-checked:bg-burgundy/10 peer-checked:text-burgundy">
          <Tx>Mandatory</Tx>
        </span>
      </label>

      {/* Measured item: the inspector enters a number and the limits decide pass or fail. */}
      <label className="group flex cursor-pointer items-center gap-2 pb-0.5">
        <input
          type="checkbox"
          name="value_type"
          value="numeric"
          checked={numeric}
          onChange={(e) => setNumeric(e.target.checked)}
          className="peer sr-only"
        />
        <span className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition-colors peer-checked:border-burgundy peer-checked:bg-burgundy/10 peer-checked:text-burgundy">
          <Tx>Measured value</Tx>
        </span>
      </label>
      {numeric && (
        <div className="flex w-full flex-wrap items-end gap-3">
          <div>
            <FormField label="Minimum">
              <input name="numeric_min" inputMode="decimal" className="mt-1 w-24 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy" />
            </FormField>
          </div>
          <div>
            <FormField label="Maximum">
              <input name="numeric_max" inputMode="decimal" className="mt-1 w-24 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy" />
            </FormField>
          </div>
          <div>
            <FormField label="Unit">
              <input name="numeric_unit" maxLength={20} placeholder={tl("mm")} className="mt-1 w-20 rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-burgundy" />
            </FormField>
          </div>
          <p className="pb-2 text-xs text-muted"><Tx>Give a minimum, a maximum, or both. A reading outside the limits fails the item.</Tx></p>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-3.5 py-2 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add item"}
      </button>
      </fieldset>
      {disabledReason && <p className="w-full text-xs text-muted"><Tx>Adding items is disabled:</Tx> {disabledReason}</p>}
      {state.error && <p className="w-full text-sm text-danger" role="alert">{state.error}</p>}
    </form>
  );
}
