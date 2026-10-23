"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  CUSTOM_ROLES_TABLE,
  CUSTOM_ROLE_PERMISSIONS_TABLE,
  CUSTOM_ROLE_ASSIGNMENTS_TABLE,
  PERMISSION_KEYS,
  CLIENT_SELF_SERVICE_PERMISSION_KEYS,
  CLIENT_MANAGED_ONLY_PERMISSION_KEYS,
} from "./types";
import { getSelfManagedOrgIdsForUser, getClientManagedOrgIdsForUser, getClientOwnedRoleOrgId } from "./access";

export interface RbacActionState {
  error: string | null;
  /** Per-input problems (keys are form field names), shown beside the field. */
  fieldErrors?: Record<string, string>;
}

const ROLES_PATH = "/inspect/organisation/roles";

/**
 * Role/permission definition used to be JAGS-Admin-only (see the migration's original header
 * comment). Widened by supabase/migrations/20260919030000_self_managed_custom_role_management.sql:
 * a Self-Managed client (organizations.engagement_scope = 'self_managed') can now also define roles
 * SCOPED TO ITS OWN organisation — never a JAGS-global role (organization_id blank/null stays
 * Admin-only, enforced both here and by RLS). These app-layer checks exist for a clear error
 * message; the RLS policies are the actual security boundary and would reject the write regardless.
 */
export async function createCustomRoleAction(_prev: RbacActionState, formData: FormData): Promise<RbacActionState> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!name) return { error: "A role name is required.", fieldErrors: { name: "Enter a role name." } };

  if (!isAdminStaff(session)) {
    if (!organizationId) return { error: "A JAGS-global role can only be created by a JAGS Admin." };
    const supabase = await createSupabaseServerClient();
    const selfManagedOrgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!selfManagedOrgIds.has(organizationId)) {
      return { error: "You can only create roles scoped to your own organisation." };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: role, error } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .insert({
      name,
      organization_id: organizationId || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !role) {
    return {
      error: error?.code === "23505" ? "A role with that name already exists in this scope." : "Could not create the role.",
      ...(error?.code === "23505" ? { fieldErrors: { name: "A role with that name already exists in this scope." } } : {}),
    };
  }

  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      entityType: "custom_role",
      entityId: role.id,
      action: "created",
      actorId: session.userId,
      summary: `Custom role "${name}" created`,
    });
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export async function deleteCustomRoleAction(_prev: RbacActionState, formData: FormData): Promise<RbacActionState> {
  const session = await requireSession();
  const roleId = String(formData.get("role_id") ?? "").trim();
  if (!roleId) return { error: "Missing role." };

  const supabase = await createSupabaseServerClient();

  if (!isAdminStaff(session)) {
    const roleOrgId = await getClientOwnedRoleOrgId(supabase, roleId);
    if (!roleOrgId) return { error: "Only a JAGS Admin can delete a JAGS-global role." };
    const selfManagedOrgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!selfManagedOrgIds.has(roleOrgId)) return { error: "You can only delete roles scoped to your own organisation." };
  }

  const { data: role } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .select("organization_id, name")
    .eq("id", roleId)
    .maybeSingle<{ organization_id: string | null; name: string }>();

  const { error } = await supabase.from(CUSTOM_ROLES_TABLE).delete().eq("id", roleId);
  if (error) return { error: "Could not delete the role." };

  if (role?.organization_id) {
    await recordAuditEvent(supabase, {
      organizationId: role.organization_id,
      entityType: "custom_role",
      entityId: roleId,
      action: "deleted",
      actorId: session.userId,
      summary: `Custom role "${role.name}" deleted`,
    });
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export async function toggleRolePermissionAction(
  _prev: RbacActionState,
  formData: FormData
): Promise<RbacActionState> {
  const session = await requireSession();
  const roleId = String(formData.get("role_id") ?? "").trim();
  const permissionKey = String(formData.get("permission_key") ?? "").trim();
  const grant = formData.get("grant") === "on";
  if (!roleId || !(PERMISSION_KEYS as readonly string[]).includes(permissionKey)) {
    return { error: "Missing role or unrecognised permission." };
  }

  const supabase = await createSupabaseServerClient();

  if (!isAdminStaff(session)) {
    const roleOrgId = await getClientOwnedRoleOrgId(supabase, roleId);
    if (!roleOrgId) return { error: "Only a JAGS Admin can change a JAGS-global role's permissions." };
    const selfManagedOrgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!selfManagedOrgIds.has(roleOrgId)) return { error: "You can only change permissions on roles scoped to your own organisation." };
    // Granting (not revoking) is restricted to the client-safe subset — see
    // CLIENT_SELF_SERVICE_PERMISSION_KEYS's doc comment for why manage_intervention_levels/issue_irn/
    // close_ncr/approve_vault_document stay JAGS-Admin-grantable-only. A client_managed org can
    // additionally grant the CLIENT_MANAGED_ONLY_PERMISSION_KEYS (approve_itp,
    // provision_party_login, run_standalone_assignment) — a plain self_managed ("Hybrid") org
    // cannot, since Hybrid must keep requiring JAGS for all three. Revoking any key (including one
    // an Admin previously granted) is always allowed — mirrors the RLS policy's using/with-check
    // split exactly.
    if (grant && !CLIENT_SELF_SERVICE_PERMISSION_KEYS.includes(permissionKey as (typeof CLIENT_SELF_SERVICE_PERMISSION_KEYS)[number])) {
      const isClientManagedOnlyKey = CLIENT_MANAGED_ONLY_PERMISSION_KEYS.includes(
        permissionKey as (typeof CLIENT_MANAGED_ONLY_PERMISSION_KEYS)[number]
      );
      const clientManagedOrgIds = isClientManagedOnlyKey ? await getClientManagedOrgIdsForUser(supabase, session.userId) : null;
      if (!isClientManagedOnlyKey || !clientManagedOrgIds!.has(roleOrgId)) {
        return { error: "That permission can only be granted by a JAGS Admin." };
      }
    }
  }

  const { error } = grant
    ? await supabase.from(CUSTOM_ROLE_PERMISSIONS_TABLE).insert({ role_id: roleId, permission_key: permissionKey })
    : await supabase
        .from(CUSTOM_ROLE_PERMISSIONS_TABLE)
        .delete()
        .eq("role_id", roleId)
        .eq("permission_key", permissionKey);

  if (error && error.code !== "23505") {
    return { error: "Could not update the role's permissions." };
  }

  const { data: role } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .select("organization_id")
    .eq("id", roleId)
    .maybeSingle<{ organization_id: string | null }>();
  if (role?.organization_id) {
    await recordAuditEvent(supabase, {
      organizationId: role.organization_id,
      entityType: "custom_role",
      entityId: roleId,
      action: grant ? "permission_granted" : "permission_revoked",
      actorId: session.userId,
      summary: `Permission "${permissionKey}" ${grant ? "granted to" : "revoked from"} role`,
      changes: { permission_key: permissionKey },
    });
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export interface AssignCustomRoleState {
  error: string | null;
}

/**
 * project_id left blank = org-wide (or platform-wide, for a JAGS-global role) assignment. A
 * self-managed client may only assign one of ITS OWN roles to ITS OWN org's users — see
 * custom_role_assignments_self_managed_write in
 * supabase/migrations/20260919030000_self_managed_custom_role_management.sql for the RLS this
 * mirrors, including the "assigned user must actually have access to this org" and "project must
 * belong to this org" checks.
 */
export async function assignCustomRoleAction(
  _prev: AssignCustomRoleState,
  formData: FormData
): Promise<AssignCustomRoleState> {
  const session = await requireSession();
  const roleId = String(formData.get("role_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!roleId || !userId) return { error: "Role and user are required." };

  const supabase = await createSupabaseServerClient();

  if (!isAdminStaff(session)) {
    const roleOrgId = await getClientOwnedRoleOrgId(supabase, roleId);
    if (!roleOrgId) return { error: "Only a JAGS Admin can assign a JAGS-global role." };
    const selfManagedOrgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!selfManagedOrgIds.has(roleOrgId)) return { error: "You can only assign roles scoped to your own organisation." };

    const { data: targetGrant } = await supabase
      .from("access_grants")
      .select("id")
      .eq("user_id", userId)
      .eq("organization_id", roleOrgId)
      .maybeSingle();
    if (!targetGrant) return { error: "That person does not have access to your organisation." };

    if (projectId) {
      const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
      if (!project || project.organization_id !== roleOrgId) {
        return { error: "That project does not belong to your organisation." };
      }
    }
  }

  const { data: assignment, error } = await supabase
    .from(CUSTOM_ROLE_ASSIGNMENTS_TABLE)
    .insert({
      role_id: roleId,
      user_id: userId,
      project_id: projectId || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !assignment) {
    return {
      error: error?.code === "23505" ? "That person already holds this role in this scope." : "Could not assign the role.",
    };
  }

  const { data: role } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .select("organization_id, name")
    .eq("id", roleId)
    .maybeSingle<{ organization_id: string | null; name: string }>();
  if (role?.organization_id) {
    await recordAuditEvent(supabase, {
      organizationId: role.organization_id,
      projectId: projectId || null,
      entityType: "custom_role_assignment",
      entityId: assignment.id,
      action: "assigned",
      actorId: session.userId,
      summary: `Role "${role.name}" assigned to ${userId}`,
    });
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export async function unassignCustomRoleAction(
  _prev: AssignCustomRoleState,
  formData: FormData
): Promise<AssignCustomRoleState> {
  const session = await requireSession();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();

  if (!isAdminStaff(session)) {
    const { data: assignment } = await supabase
      .from(CUSTOM_ROLE_ASSIGNMENTS_TABLE)
      .select("role_id")
      .eq("id", assignmentId)
      .maybeSingle<{ role_id: string }>();
    if (!assignment) return { error: "Assignment not found." };
    const roleOrgId = await getClientOwnedRoleOrgId(supabase, assignment.role_id);
    if (!roleOrgId) return { error: "Only a JAGS Admin can remove this assignment." };
    const selfManagedOrgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!selfManagedOrgIds.has(roleOrgId)) return { error: "You can only remove assignments on roles scoped to your own organisation." };
  }

  const { data: assignmentRow } = await supabase
    .from(CUSTOM_ROLE_ASSIGNMENTS_TABLE)
    .select("role_id, custom_roles(organization_id, name)")
    .eq("id", assignmentId)
    .maybeSingle<{ role_id: string; custom_roles: { organization_id: string | null; name: string } | null }>();

  const { error } = await supabase.from(CUSTOM_ROLE_ASSIGNMENTS_TABLE).delete().eq("id", assignmentId);
  if (error) return { error: "Could not remove the assignment." };

  if (assignmentRow?.custom_roles?.organization_id) {
    await recordAuditEvent(supabase, {
      organizationId: assignmentRow.custom_roles.organization_id,
      entityType: "custom_role_assignment",
      entityId: assignmentId,
      action: "unassigned",
      actorId: session.userId,
      summary: `Role "${assignmentRow.custom_roles.name}" assignment removed`,
    });
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}
