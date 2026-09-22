"use client";

import { useActionState } from "react";
import { updateLibraryTemplateAction, type LibraryTemplateFormState } from "@/lib/checklist-library/actions";
import { Button } from "@/components/ui/button";

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
  const [state, formAction, pending] = useActionState(updateLibraryTemplateAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="template_id" value={templateId} />
      <div>
        <label htmlFor="edit_template_title" className="block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="edit_template_title"
          name="title"
          required
          defaultValue={title}
          className="mt-1 w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label htmlFor="edit_template_discipline" className="block text-sm font-medium text-ink">
          Discipline
        </label>
        <select
          id="edit_template_discipline"
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
      </div>
      <div>
        <label htmlFor="edit_template_organization" className="block text-sm font-medium text-ink">
          Client <span className="font-normal text-muted">(optional)</span>
        </label>
        <select
          id="edit_template_organization"
          name="organization_id"
          defaultValue={organizationId ?? ""}
          className="mt-1 w-48 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">Global — shared with every client</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[16rem]">
        <label htmlFor="edit_template_description" className="block text-sm font-medium text-ink">
          Description
        </label>
        <input
          id="edit_template_description"
          name="description"
          defaultValue={description ?? ""}
          placeholder="Optional — what this template is for"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save details"}
      </Button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
