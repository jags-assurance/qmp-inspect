"use client";

import { useActionState, useState } from "react";
import { copyMasterTemplateToItpAction, type CopyMasterTemplateState } from "@/lib/itp-master/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { useActiveProjectDefault } from "@/lib/projects/use-active-project-default";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(copyMasterTemplateToItpAction, initialState);
  const [projectId, setProjectId] = useState("");
  useActiveProjectDefault(projects.map((p) => p.id), projectId, setProjectId);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <FormField label="Master template">
          <select
          name="master_template_id"
          required
          defaultValue={defaultTemplateId ?? ""}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value=""><Tx>Select…</Tx></option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.industry || "—"}, v{t.version})
            </option>
          ))}
        </select>
        </FormField>
      </div>

      <div>
        <FormField label="Project">
          <select
          name="project_id"
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value=""><Tx>Select…</Tx></option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_number} — {p.name}
            </option>
          ))}
        </select>
        </FormField>
      </div>

      <div>
        <FormField label="ITP number (optional)">
          <input
          name="itp_number"
          placeholder={tl("Leave blank to auto-number")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy doc-id"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Title">
          <input
          name="title"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Applicable standard">
          <input
          name="applicable_standard"
          placeholder={tl("e.g. IEC 61439")}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create ITP from template"}
      </Button>
    </form>
  );
}
