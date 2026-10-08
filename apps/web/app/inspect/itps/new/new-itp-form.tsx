"use client";

import { useActionState } from "react";
import { createItpAction, type CreateItpState } from "@/lib/itps/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

const initialState: CreateItpState = { error: null };

export function NewItpForm({
  projects,
}: {
  projects: { id: string; project_number: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createItpAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <FormField label="Project" error={state.fieldErrors?.project_id}>
          <select
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
        </FormField>
      </div>

      <div>
        <label htmlFor="itp_number" className="block text-sm font-medium text-ink">
          ITP number <span className="font-normal text-muted">(optional — auto-generated if left blank)</span>
        </label>
        <input
          id="itp_number"
          name="itp_number"
          placeholder="Leave blank to auto-generate, e.g. MER-JAGS-ITP-002"
          aria-invalid={state.fieldErrors?.itp_number ? true : undefined}
          aria-describedby={state.fieldErrors?.itp_number ? "itp_number-err" : undefined}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy doc-id"
        />
        {state.fieldErrors?.itp_number && (
          <p id="itp_number-err" role="alert" className="mt-1 text-xs font-medium text-danger">{state.fieldErrors.itp_number}</p>
        )}
      </div>

      <div>
        <FormField label="Title" error={state.fieldErrors?.title}>
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
          placeholder="e.g. IEC 61439"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Scope (optional)">
          <textarea
          name="scope"
          rows={3}
          placeholder="What work this plan covers, e.g. Structural concrete — foundations, Block A"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create ITP"}
      </Button>
    </form>
  );
}
