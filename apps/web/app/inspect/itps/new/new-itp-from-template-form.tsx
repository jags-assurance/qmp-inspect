"use client";

import { useActionState, useState } from "react";
import { copyMasterTemplateToItpAction, type CopyMasterTemplateState } from "@/lib/itp-master/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { FormMessage } from "@/components/ui/form-message";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { useActiveProjectDefault } from "@/lib/projects/use-active-project-default";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const [projectId, setProjectId] = useState("");
  useActiveProjectDefault(projects.map((p) => p.id), projectId, setProjectId);

  return (
    <form onSubmit={keepValuesSubmit} className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <p className="text-xs text-muted"><span aria-hidden="true" className="text-danger">*</span> <Tx>required</Tx></p>
      <div>
        <FormField required label="Master template">
          <select
          name="master_template_id"
          required
          defaultValue={defaultTemplateId ?? ""}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
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
        <FormField required label="Project">
          <select
          name="project_id"
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
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
          <input aria-label={tl("Leave blank to auto-number")}
          name="itp_number"
          placeholder={tl("Leave blank to auto-number")}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm doc-id"
        />
        </FormField>
      </div>

      <div>
        <FormField required label="Title">
          <input
          name="title"
          required
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Applicable standard">
          <input
          name="applicable_standard"
          placeholder={tl("e.g. IEC 61439")}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        />
        </FormField>
      </div>

      <FormMessage error={state.error} />

      <StickyActionBar inCard>
        <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create ITP from template"}
      </Button>
      </StickyActionBar>
    </form>
  );
}
