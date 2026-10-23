"use client";

import { useActionState } from "react";
import { addPunchItemAction, type AddPunchItemState } from "@/lib/standalone/actions";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: AddPunchItemState = { error: null };

export function AddPunchItemForm({ assignmentId }: { assignmentId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(addPunchItemAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="flex flex-wrap items-end gap-2 border-t border-border bg-off-white px-4 py-3">
      <input type="hidden" name="assignment_id" value={assignmentId} />

      <div className="min-w-48 flex-1">
        <FormField label="Description">
          <input
          name="description"
          required
          placeholder={tl("What needs fixing…")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button
        type="submit"
        disabled={pending}
        variant="outline" size="sm"
      >
        {pending ? "Adding…" : "+ Add punch item"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
