"use client";

import { useActionState, useState } from "react";
import { addStaffGrantAction, type StaffAccessState } from "@/lib/staff-access/actions";

const initialState: StaffAccessState = { error: null };

export interface StaffOption {
  id: string;
  full_name: string;
  email: string;
}

export interface OrgOption {
  id: string;
  name: string;
}

export interface ProjectOption {
  id: string;
  name: string;
  organization_id: string;
}

export function StaffGrantForm({
  staff,
  organizations,
  projects,
}: {
  staff: StaffOption[];
  organizations: OrgOption[];
  projects: ProjectOption[];
}) {
  const [state, formAction, pending] = useActionState(addStaffGrantAction, initialState);
  const [scopeType, setScopeType] = useState<"global" | "organization" | "project">("global");
  const [organizationId, setOrganizationId] = useState("");

  const projectsInOrg = projects.filter((p) => p.organization_id === organizationId);

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-off-white p-4">
      <div>
        <label className="block text-xs text-muted">Staff member</label>
        <select
          name="staff_user_id"
          required
          className="mt-1 w-56 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name} ({s.email})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-muted">Scope</label>
        <select
          name="scope_type"
          value={scopeType}
          onChange={(e) => setScopeType(e.target.value as typeof scopeType)}
          className="mt-1 w-36 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        >
          <option value="global">Global (every client)</option>
          <option value="organization">One organisation</option>
          <option value="project">One project</option>
        </select>
      </div>

      {(scopeType === "organization" || scopeType === "project") && (
        <div>
          <label className="block text-xs text-muted">Organisation</label>
          <select
            name="organization_id"
            value={organizationId}
            onChange={(e) => setOrganizationId(e.target.value)}
            required
            className="mt-1 w-48 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
          >
            <option value="">— choose —</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {scopeType === "project" && (
        <div>
          <label className="block text-xs text-muted">Project</label>
          <select
            name="project_id"
            required
            disabled={!organizationId}
            className="mt-1 w-48 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy disabled:opacity-50"
          >
            <option value="">— choose —</option>
            {projectsInOrg.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-muted">Role label</label>
        <input
          name="role"
          required
          placeholder="jags_inspector"
          defaultValue="jags_inspector"
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-burgundy px-4 py-1.5 text-sm font-medium text-white hover:bg-burgundy-dark disabled:opacity-50"
      >
        {pending ? "Adding…" : "+ Add grant"}
      </button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
