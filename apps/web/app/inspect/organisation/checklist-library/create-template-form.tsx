"use client";

import { useActionState } from "react";
import { createLibraryTemplateAction, type LibraryTemplateFormState } from "@/lib/checklist-library/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: LibraryTemplateFormState = { error: null };

export function CreateTemplateForm({
  disciplines,
  organizations,
}: {
  disciplines: { id: string; name: string }[];
  /** R46: client organisations this template can optionally be scoped to — left unset (the
   *  default), the template stays global/shared across every client. */
  organizations: { id: string; name: string }[];
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createLibraryTemplateAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <div>
        <FormField required label="Title">
          <input
          name="title"
          required
          placeholder={tl("e.g. Structural Steel Weld Inspection")}
          className="mt-1 w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <div>
        <FormField label="Discipline">
          <select
          name="discipline_id"
          className="mt-1 w-48 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">—</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        </FormField>
      </div>
      <div>
        <label htmlFor="new_template_organization" className="block text-sm font-medium text-ink">
          <Tx>Client</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
        </label>
        <select
          id="new_template_organization"
          name="organization_id"
          className="mt-1 w-48 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value=""><Tx>Global — shared with every client</Tx></option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 w-full sm:min-w-[16rem]">
        <FormField label="Description">
          <input
          name="description"
          placeholder={tl("Optional — what this template is for")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Build new template"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
