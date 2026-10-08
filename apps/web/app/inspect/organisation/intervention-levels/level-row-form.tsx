"use client";

import { useActionState } from "react";
import { updateInterventionLevelAction, deleteInterventionLevelAction, type InterventionLevelState } from "@/lib/intervention-levels/actions";
import type { InterventionLevelTypeRow } from "@/lib/intervention-levels/types";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: InterventionLevelState = { error: null };

/** One editable row: rename the label, reorder (sort_order), mark blocking or not, and set a
 *  default notice-period. The `code` itself is shown but not editable here — see doc comment on
 *  updateInterventionLevelAction for why. Delete is a separate form using the plain-action variant
 *  (no client-side pending state needed for a single destructive click, mirrors
 *  remove-grant-button.tsx's pattern elsewhere in this app), and surfaces the DB's "still in use"
 *  guard as a plain error instead of letting a raw exception bubble up.
 */
export function LevelRowForm({ level }: { level: InterventionLevelTypeRow }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(updateInterventionLevelAction, initialState);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteInterventionLevelAction, initialState);

  return (
    <div className="py-3">
      <form action={formAction} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-3 lg:grid-cols-[60px_1fr_90px_90px_110px_auto]">
        <input type="hidden" name="id" value={level.id} />
        <div>
          <label className="block text-xs text-muted"><Tx>Code</Tx></label>
          <span className="doc-id mt-1 block text-sm font-semibold text-ink">{level.code}</span>
        </div>
        <div>
          <FormField label="Label">
            <input
            name="label"
            required
            defaultValue={level.label}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        <div>
          <FormField label="Order">
            <input
            name="sort_order"
            type="number"
            defaultValue={level.sort_order}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-muted">
          <input type="checkbox" name="is_blocking" defaultChecked={level.is_blocking} />
          <Tx>Blocking</Tx>
        </label>
        <div>
          <FormField label="Notice hrs">
            <input
            name="default_notice_hours"
            type="number"
            min={0}
            defaultValue={level.default_notice_hours ?? ""}
            placeholder={tl("none")}
            className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          />
          </FormField>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
      {state.error && <p role="alert" className="mt-1 text-sm text-danger">{state.error}</p>}

      <form action={deleteAction} className="mt-1.5">
        <input type="hidden" name="id" value={level.id} />
        <button
          type="submit"
          disabled={deletePending}
          className="text-xs font-medium text-danger hover:underline disabled:opacity-50"
        >
          {deletePending ? "Removing…" : "Remove level"}
        </button>
      </form>
      {deleteState.error && <p role="alert" className="mt-1 text-sm text-danger">{deleteState.error}</p>}
    </div>
  );
}
