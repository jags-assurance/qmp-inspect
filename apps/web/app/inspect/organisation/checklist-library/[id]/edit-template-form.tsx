"use client";

import { useActionState } from "react";
import { updateLibraryTemplateAction, type LibraryTemplateFormState } from "@/lib/checklist-library/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: LibraryTemplateFormState = { error: null };

/**
 * R46: staff-only editor for a library template's own details, including the (optional) client
 * scope — left unset, the template stays global/shared with every client.
 */
export function EditTemplateForm({
  templateId,
  title,
  description,
  disciplineId,
  organizationId,
  disciplines,
  organizations,
}: {
  templateId: string;
  title: string;
  description: string | null;
  disciplineId: string | null;
  organizationId: string | null;
  disciplines: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(updateLibraryTemplateAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="template_id" value={templateId} />
      <div>
        <FormField label="Title">
          <input
          name="title"
          required
          defaultValue={title}
          className="mt-1 w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <div>
        <FormField label="Discipline">
          <select
          name="discipline_id"
          defaultValue={disciplineId ?? ""}
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
        <label htmlFor="edit_template_organization" className="block text-sm font-medium text-ink">
          <Tx>Client</Tx> <span className="font-normal text-muted"><Tx>(optional)</Tx></span>
        </label>
        <select
          id="edit_template_organization"
          name="organization_id"
          defaultValue={organizationId ?? ""}
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
          defaultValue={description ?? ""}
          placeholder={tl("Optional — what this template is for")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </Button>
      {state.error && <p role="alert" className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
