"use client";

import { useActionState } from "react";
import { copyMasterTemplateToItpAction, type CopyMasterTemplateState } from "@/lib/itp-master/actions";
import { Button } from "@/components/ui/button";

const initialState: CopyMasterTemplateState = { error: null };

export function NewItpFromTemplateForm({
  projects,
  templates,
  defaultTemplateId,
}: {
  defaultTemplateId?: string;
  projects: { id: string; project_number: string; name: string }[];
  templates: { id: string; title: string; industry: string; version: number }[];
}) {
  const [state, formAction, pending] = useActionState(copyMasterTemplateToItpAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <label htmlFor="master_template_id" className="block text-sm font-medium text-ink">
          Master template
        </label>
        <select
          id="master_template_id"
          name="master_template_id"
          required
          defaultValue={defaultTemplateId ?? ""}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">Select…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.industry || "—"}, v{t.version})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="template_project_id" className="block text-sm font-medium text-ink">
          Project
        </label>
        <select
          id="template_project_id"
          name="project_id"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">Select…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_number} — {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="template_itp_number" className="block text-sm font-medium text-ink">
          ITP number (optional)
        </label>
        <input
          id="template_itp_number"
          name="itp_number"
          placeholder="Leave blank to auto-number"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy doc-id"
        />
      </div>

      <div>
        <label htmlFor="template_title" className="block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="template_title"
          name="title"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label htmlFor="template_applicable_standard" className="block text-sm font-medium text-ink">
          Applicable standard
        </label>
        <input
          id="template_applicable_standard"
          name="applicable_standard"
          placeholder="e.g. IEC 61439"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create ITP from template"}
      </Button>
    </form>
  );
}
