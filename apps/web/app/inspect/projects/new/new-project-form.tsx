"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createProjectAction, type CreateProjectState } from "@/lib/projects/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { TimeZoneOptions } from "@/components/domain/timezone-options";

const initialState: CreateProjectState = { error: null };

export function NewProjectForm({
  organizations,
  allowCreateOrg = true,
  staffUsers = [],
}: {
  organizations: { id: string; name: string }[];
  /** Hidden for a Self-Managed client creating their own project — they can't create a new
   *  organisation, only a project under the one they already belong to. */
  allowCreateOrg?: boolean;
  /** JAGS staff who can be named as the project's responsible person (Admin only). */
  staffUsers?: { id: string; full_name: string; email: string }[];
}) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="organization_id" className="block text-sm font-medium text-ink">
            Client organisation
          </label>
          {allowCreateOrg && (
            <Link href="/inspect/organisation/clients" className="text-xs font-medium text-burgundy hover:underline">
              + New organisation
            </Link>
          )}
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
        <FormField label="Project number">
          <input
          name="project_number"
          required
          placeholder="e.g. MER-2026-001"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Project name">
          <input
          name="name"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div>
        <FormField label="Site location">
          <input
          name="site_location"
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FormField label="Country (optional)">
            <input name="country" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
          </FormField>
        </div>
        <div>
          <FormField label="Contract number (optional)">
            <input name="contract_number" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
          </FormField>
        </div>
        <div>
          <FormField label="Start date (optional)">
            <input name="start_date" type="date" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
          </FormField>
        </div>
        <div>
          <FormField label="End date (optional)">
            <input name="end_date" type="date" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
          </FormField>
        </div>
        <div>
          <FormField label="Site time zone (optional)">
            <input name="timezone" list="project-timezones" maxLength={64} placeholder="e.g. Asia/Dubai (default UTC)" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
          </FormField>
          <TimeZoneOptions />
        </div>
        <div>
          <FormField label="Status">
            <select name="status" defaultValue="active" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
          </select>
          </FormField>
        </div>
      </div>
      <div>
        <label htmlFor="locations" className="block text-sm font-medium text-ink">
          Inspection locations (optional, one per line)
        </label>
        <textarea id="locations" name="locations" rows={3} placeholder={"Block A\nBlock B\nPump house"} className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy" />
        <p className="mt-1 text-xs text-muted">These appear in the location dropdown when an inspection is started on this project.</p>
      </div>
      {staffUsers.length > 0 && (
        <div>
          <FormField label="Responsible person (optional)">
            <select name="responsible_person_id" defaultValue="" className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy">
            <option value="">— none set —</option>
            {staffUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
          </FormField>
        </div>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
