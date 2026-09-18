"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { CUSTOM_ROLES_TABLE, CUSTOM_ROLE_PERMISSIONS_TABLE, CUSTOM_ROLE_ASSIGNMENTS_TABLE, PERMISSION_KEYS } from "./types";

export interface RbacActionState {
  error: string | null;
}

const ROLES_PATH = "/inspect/organisation/roles";

/**
 * Role/permission definition is JAGS-Admin-only for this round (see the migration's header comment
 * on why — there's no "client org admin" account type yet to safely delegate this to). Leaving
 * organization_id blank creates a JAGS-global role usable by any staff assignment; setting it scopes
 * the role to that one client organisation's own people.
 */
export async function createCustomRoleAction(_prev: RbacActionState, formData: FormData): Promise<RbacActionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can create a custom role." };

  const name = String(formData.get("name") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!name) return { error: "A role name is required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CUSTOM_ROLES_TABLE).insert({
    name,
    organization_id: organizationId || null,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "A role with that name already exists in this scope." : "Could not create the role.",
    };
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export async function deleteCustomRoleAction(_prev: RbacActionState, formData: FormData): Promise<RbacActionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can delete a custom role." };

  const roleId = String(formData.get("role_id") ?? "").trim();
  if (!roleId) return { error: "Missing role." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CUSTOM_ROLES_TABLE).delete().eq("id", roleId);
  if (error) return { error: "Could not delete the role." };

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export async function toggleRolePermissionAction(
  _prev: RbacActionState,
  formData: FormData
): Promise<RbacActionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change a role's permissions." };

  const roleId = String(formData.get("role_id") ?? "").trim();
  const permissionKey = String(formData.get("permission_key") ?? "").trim();
  const grant = formData.get("grant") === "on";
  if (!roleId || !(PERMISSION_KEYS as readonly string[]).includes(permissionKey)) {
    return { error: "Missing role or unrecognised permission." };
  }

  const supabase = await createSupabaseServerClient();
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

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export interface AssignCustomRoleState {
  error: string | null;
}

/** project_id left blank = org-wide (or platform-wide, for a JAGS-global role) assignment. */
export async function assignCustomRoleAction(
  _prev: AssignCustomRoleState,
  formData: FormData
): Promise<AssignCustomRoleState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can assign a custom role." };

  const roleId = String(formData.get("role_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!roleId || !userId) return { error: "Role and user are required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CUSTOM_ROLE_ASSIGNMENTS_TABLE).insert({
    role_id: roleId,
    user_id: userId,
    project_id: projectId || null,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "That person already holds this role in this scope." : "Could not assign the role.",
    };
  }

  revalidatePath(ROLES_PATH);
  return { error: null };
}

export async function unassignCustomRoleAction(
  _prev: AssignCustomRoleState,
  formData: FormData
): Promise<AssignCustomRoleState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can remove a role assignment." };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CUSTOM_ROLE_ASSIGNMENTS_TABLE).delete().eq("id", assignmentId);
  if (error) return { error: "Could not remove the assignment." };

  revalidatePath(ROLES_PATH);
  return { error: null };
}
