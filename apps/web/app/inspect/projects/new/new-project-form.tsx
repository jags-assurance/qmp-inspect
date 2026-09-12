"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createProjectAction, type CreateProjectState } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";

const initialState: CreateProjectState = { error: null };

export function NewProjectForm({ organizations }: { organizations: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="organization_id" className="block text-sm font-medium text-ink">
            Client organisation
          </label>
          <Link href="/inspect/organisation/clients" className="text-xs font-medium text-burgundy hover:underline">
            + New organisation
          </Link>
        </div>
        <select
          id="organization_id"
          name="organization_id"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        >
          <option value="">Select…</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {organizations.length === 0 && (
          <p className="mt-1 text-xs text-muted">
            No client organisations exist yet — create one first.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="project_number" className="block text-sm font-medium text-ink">
          Project number
        </label>
        <input
          id="project_number"
          name="project_number"
          required
          placeholder="e.g. MER-2026-001"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink">
          Project name
        </label>
        <input
          id="name"
          name="name"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div>
        <label htmlFor="site_location" className="block text-sm font-medium text-ink">
          Site location
        </label>
        <input
          id="site_location"
          name="site_location"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
