"use client";

import { useActionState } from "react";
import {
  deleteCustomRoleAction,
  toggleRolePermissionAction,
  assignCustomRoleAction,
  unassignCustomRoleAction,
  type RbacActionState,
  type AssignCustomRoleState,
} from "@/lib/rbac/actions";
import {
  PERMISSION_KEYS,
  PERMISSION_LABEL,
  CLIENT_SELF_SERVICE_PERMISSION_KEYS,
  CLIENT_MANAGED_ONLY_PERMISSION_KEYS,
  type PermissionKey,
} from "@/lib/rbac/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tx } from "@/components/domain/tx";

const deleteInitial: RbacActionState = { error: null };
const toggleInitial: RbacActionState = { error: null };
const assignInitial: AssignCustomRoleState = { error: null };

export interface RoleCardData {
  id: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  grantedPermissions: Set<PermissionKey>;
  assignments: { id: string; userName: string; userEmail: string; projectName: string | null }[];
}

export function RoleCard({
  role,
  users,
  projects,
  restrictGrantableKeys = false,
  isClientManagedOrg = false,
}: {
  role: RoleCardData;
  users: { id: string; full_name: string; email: string }[];
  projects: { id: string; name: string }[];
  /**
   * True for a self-managed client (never for the Admin view): disables the toggle for the
   * JAGS-operational-only keys (manage_intervention_levels/issue_irn/close_ncr/
   * approve_vault_document — see CLIENT_SELF_SERVICE_PERMISSION_KEYS's doc comment) UNLESS already
   * granted, in which case it stays clickable to revoke — mirrors the RLS policy's
   * grant-restricted/revoke-unrestricted split exactly.
   */
  restrictGrantableKeys?: boolean;
  /**
   * True when this role's own organisation is on the client_managed ("Full Client-Managed") tier —
   * lets the CLIENT_MANAGED_ONLY_PERMISSION_KEYS (approve_itp, provision_party_login,
   * run_standalone_assignment) also be grantable, on top of the always-grantable
   * CLIENT_SELF_SERVICE_PERMISSION_KEYS. A plain
   * self_managed ("Hybrid") org's roles keep this false.
   */
  isClientManagedOrg?: boolean;
}) {
  const [deleteState, deleteAction, deletePending] = useActionState(deleteCustomRoleAction, deleteInitial);
  const [toggleState, toggleAction] = useActionState(toggleRolePermissionAction, toggleInitial);
  const [assignState, assignAction, assignPending] = useActionState(assignCustomRoleAction, assignInitial);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-ink">{role.name}</p>
            <Badge tone="neutral">
              {role.grantedPermissions.size} <Tx>permission</Tx>{role.grantedPermissions.size === 1 ? "" : "s"}
            </Badge>
            <Badge tone="neutral">
              {role.assignments.length} <Tx>assignment</Tx>{role.assignments.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="text-xs text-muted">{role.organizationName ?? "JAGS-global"}</p>
        </div>
        <form action={deleteAction}>
          <input type="hidden" name="role_id" value={role.id} />
          <Button type="submit" disabled={deletePending} variant="link-danger" size="sm">
            {deletePending ? "Deleting…" : "Delete role"}
          </Button>
        </form>
      </div>
      {deleteState.error && <p role="alert" className="mt-1 text-xs text-danger">{deleteState.error}</p>}

      <div className="mt-3">
        <p className="text-xs font-medium text-muted"><Tx>Permissions</Tx></p>
        <div className="mt-1 flex flex-wrap gap-2">
          {PERMISSION_KEYS.map((key) => {
            const granted = role.grantedPermissions.has(key);
            const clientCanGrant =
              CLIENT_SELF_SERVICE_PERMISSION_KEYS.includes(key) ||
              (isClientManagedOrg && CLIENT_MANAGED_ONLY_PERMISSION_KEYS.includes(key));
            // Only disable the not-yet-granted (grant) direction — revoking an already-granted
            // admin-only key must stay clickable, matching the server action/RLS exactly.
            const disabled = restrictGrantableKeys && !granted && !clientCanGrant;
            return (
              <form key={key} action={toggleAction}>
                <input type="hidden" name="role_id" value={role.id} />
                <input type="hidden" name="permission_key" value={key} />
                <input type="hidden" name="grant" value={granted ? "" : "on"} />
                <button
                  type="submit"
                  disabled={disabled}
                  title={disabled ? "Only a JAGS Admin can grant this permission." : undefined}
                  className={
                    "rounded-full border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 " +
                    (granted ? "border-burgundy bg-burgundy/10 text-burgundy" : "border-border text-muted hover:bg-off-white")
                  }
                >
                  {PERMISSION_LABEL[key]}
                </button>
              </form>
            );
          })}
        </div>
        {toggleState.error && <p role="alert" className="mt-1 text-xs text-danger">{toggleState.error}</p>}
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-medium text-muted"><Tx>Assigned to</Tx></p>
        <div className="mt-1 space-y-1">
          {role.assignments.map((a) => (
            <AssignmentRow key={a.id} assignmentId={a.id} userName={a.userName} userEmail={a.userEmail} projectName={a.projectName} />
          ))}
          {role.assignments.length === 0 && <p className="text-xs text-muted"><Tx>No one holds this role yet.</Tx></p>}
        </div>

        <form action={assignAction} className="mt-2 flex flex-wrap items-end gap-2">
          <input type="hidden" name="role_id" value={role.id} />
          <select name="user_id" required className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy">
            <option value=""><Tx>— choose person —</Tx></option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
          <select name="project_id" className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy">
            <option value=""><Tx>Org/platform-wide</Tx></option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} <Tx>only</Tx>
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={assignPending}>
            {assignPending ? "Assigning…" : "Assign"}
          </Button>
        </form>
        {assignState.error && <p role="alert" className="mt-1 text-xs text-danger">{assignState.error}</p>}
      </div>
    </div>
  );
}

function AssignmentRow({
  assignmentId,
  userName,
  userEmail,
  projectName,
}: {
  assignmentId: string;
  userName: string;
  userEmail: string;
  projectName: string | null;
}) {
  const [state, action, pending] = useActionState(unassignCustomRoleAction, assignInitial);

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ink">
        {userName} ({userEmail}) {projectName ? `· ${projectName} only` : "· org/platform-wide"}
      </span>
      <form action={action}>
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <Button type="submit" disabled={pending} variant="link-muted">
          {pending ? "Removing…" : "Remove"}
        </Button>
      </form>
      {state.error && <span className="ms-2 text-danger">{state.error}</span>}
    </div>
  );
}
