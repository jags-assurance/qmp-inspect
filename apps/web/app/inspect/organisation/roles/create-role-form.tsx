"use client";

import { useActionState } from "react";
import { createCustomRoleAction, type RbacActionState } from "@/lib/rbac/actions";
import { Button } from "@/components/ui/button";

const initialState: RbacActionState = { error: null };

export function CreateRoleForm({
  organizations,
  lockedOrganizationId = null,
}: {
  organizations: { id: string; name: string }[];
  /**
   * Set for a self-managed client (their one own organisation id) — hides the org picker entirely
   * and always submits this org, so a client can never create a JAGS-global role or a role scoped
   * to a different organisation. Null/omitted for the Admin view, which keeps the full picker
   * (including the JAGS-global option) exactly as before.
   */
  lockedOrganizationId?: string | null;
}) {
  const [state, formAction, pending] = useActionState(createCustomRoleAction, initialState);

  return (
    <form action={formAction} className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <div>
        <label htmlFor="role_name" className="block text-sm font-medium text-ink">
          Role name
        </label>
        <input
          id="role_name"
          name="name"
          required
          placeholder="e.g. Project Coordinator"
          className="mt-1 w-56 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>
      {lockedOrganizationId ? (
        <input type="hidden" name="organization_id" value={lockedOrganizationId} />
      ) : (
        <div>
          <label htmlFor="role_org" className="block text-sm font-medium text-ink">
            Scope
          </label>
          <select
            id="role_org"
            name="organization_id"
            className="mt-1 w-56 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          >
            <option value="">JAGS-global (any staff assignment)</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} (this client&apos;s own people)
              </option>
            ))}
          </select>
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create role"}
      </Button>
      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
