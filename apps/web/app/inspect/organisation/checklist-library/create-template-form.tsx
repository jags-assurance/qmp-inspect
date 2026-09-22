"use client";

import { useActionState } from "react";
import { createLibraryTemplateAction, type LibraryTemplateFormState } from "@/lib/checklist-library/actions";
import { Button } from "@/components/ui/button";

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
  const [state, formAction, pending] = useActionState(createLibraryTemplateAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <div>
        <label htmlFor="new_template_title" className="block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="new_template_title"
          name="title"
          required
          placeholder="e.g. Structural Steel Weld Inspection"
          className="mt-1 w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label htmlFor="new_template_discipline" className="block text-sm font-medium text-ink">
          Discipline
        </label>
        <select
          id="new_template_discipline"
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
      </div>
      <div>
        <label htmlFor="new_template_organization" className="block text-sm font-medium text-ink">
          Client <span className="font-normal text-muted">(optional)</span>
        </label>
        <select
          id="new_template_organization"
          name="organization_id"
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
        <label htmlFor="new_template_description" className="block text-sm font-medium text-ink">
          Description
        </label>
        <input
          id="new_template_description"
          name="description"
          placeholder="Optional — what this template is for"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Build new template"}
      </Button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
