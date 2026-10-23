"use client";

import { useActionState, useState } from "react";
import {
  attachLibraryTemplateToActivityAction,
  type AttachLibraryTemplateState,
} from "@/lib/checklist-library/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: AttachLibraryTemplateState = { error: null };

/**
 * R44/R47: the "attach an existing library template" alternative to the blank auto-generate path,
 * offered inline per not-yet-generated activity on the ITP's checklists page. Deliberately compact
 * (a select + a small button) since it sits inside a table cell alongside every other row.
 */
export function AttachLibraryTemplateForm({
  itpItemId,
  libraryTemplates,
}: {
  itpItemId: string;
  libraryTemplates: { id: string; title: string }[];
}) {
  const [state, formAction, pending] = useActionState(attachLibraryTemplateToActivityAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [selected, setSelected] = useState("");

  return (
    <form onSubmit={keepValuesSubmit} className="flex items-center justify-end gap-1.5">
      <input type="hidden" name="itp_item_id" value={itpItemId} />
      <select
        name="library_template_id"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
      >
        <option value=""><Tx>Attach library template…</Tx></option>
        {libraryTemplates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <Button
        type="submit"
        disabled={pending || !selected}
        variant="outline" size="sm"
      >
        {pending ? "Attaching…" : "Attach"}
      </Button>
      {state.error && <p role="alert" className="w-full text-end text-xs text-danger">{state.error}</p>}
    </form>
  );
}
