"use client";

import { useActionState } from "react";
import { createItpAction, type CreateItpState } from "@/lib/itps/actions";
import { Button } from "@/components/ui/button";

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
        <label htmlFor="project_id" className="block text-sm font-medium text-ink">
          Project
        </label>
        <select
          id="project_id"
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
        <label htmlFor="itp_number" className="block text-sm font-medium text-ink">
          ITP number <span className="font-normal text-muted">(optional — auto-generated if left blank)</span>
        </label>
        <input
          id="itp_number"
          name="itp_number"
          placeholder="Leave blank to auto-generate, e.g. MER-JAGS-ITP-002"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy doc-id"
        />
      </div>

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label htmlFor="applicable_standard" className="block text-sm font-medium text-ink">
          Applicable standard
        </label>
        <input
          id="applicable_standard"
          name="applicable_standard"
          placeholder="e.g. IEC 61439"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label htmlFor="scope" className="block text-sm font-medium text-ink">
          Scope (optional)
        </label>
        <textarea
          id="scope"
          name="scope"
          rows={3}
          placeholder="What work this plan covers, e.g. Structural concrete — foundations, Block A"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create ITP"}
      </Button>
    </form>
  );
}
