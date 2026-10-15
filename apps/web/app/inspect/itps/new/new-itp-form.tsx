"use client";

import { useActionState, useState } from "react";
import { createItpAction, type CreateItpState } from "@/lib/itps/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { FormMessage } from "@/components/ui/form-message";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { NextNumberHint } from "@/components/domain/next-number-hint";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useActiveProjectDefault } from "@/lib/projects/use-active-project-default";

const initialState: CreateItpState = { error: null };

export function NewItpForm({
  projects,
}: {
  projects: { id: string; project_number: string; name: string }[];
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(createItpAction, initialState);
  const [projectId, setProjectId] = useState("");
  useActiveProjectDefault(projects.map((p) => p.id), projectId, setProjectId);

  return (
    <form action={formAction} className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      <p className="text-xs text-muted"><span aria-hidden="true" className="text-danger">*</span> <Tx>required</Tx></p>
      <div>
        <FormField required label="Project" error={state.fieldErrors?.project_id}>
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
        <label htmlFor="itp_number" className="block text-sm font-medium text-ink">
          <Tx>ITP number</Tx> <span className="font-normal text-muted"><Tx>(optional — auto-generated if left blank)</Tx></span>
        </label>
        <input
          id="itp_number"
          name="itp_number"
          placeholder={tl("Leave blank to auto-generate, e.g. MER-JAGS-ITP-002")}
          aria-invalid={state.fieldErrors?.itp_number ? true : undefined}
          aria-describedby={state.fieldErrors?.itp_number ? "itp_number-err" : undefined}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm doc-id"
        />
        <NextNumberHint kind="itp" id={projectId} />
        {state.fieldErrors?.itp_number && (
          <p id="itp_number-err" role="alert" className="mt-1 text-xs font-medium text-danger">{state.fieldErrors.itp_number}</p>
        )}
      </div>

      <div>
        <FormField required label="Title" error={state.fieldErrors?.title}>
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

      <div>
        <FormField label="Scope (optional)">
          <textarea
          name="scope"
          rows={3}
          placeholder={tl("What work this plan covers, e.g. Structural concrete — foundations, Block A")}
          className="mt-1 w-full min-h-11 rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
        />
        </FormField>
      </div>

      <FormMessage error={state.error} />

      <StickyActionBar inCard>
        <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create ITP"}
      </Button>
      </StickyActionBar>
    </form>
  );
}
