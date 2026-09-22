import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PermissionKey } from "./types";

/**
 * Checks whether the CURRENT signed-in user holds a custom-role assignment granting
 * `permissionKey`, optionally scoped to one project. Calls the SECURITY DEFINER
 * has_custom_permission() RPC (supabase/migrations/20260918020000_custom_rbac.sql) rather than
 * querying the three RBAC tables directly, so this works the same way whether the caller can see
 * the underlying role rows or not.
 *
 * This is always an ADDITIONAL allow-path, never a replacement: every call site that uses this
 * already has its own baseline check (isAdminStaff, party_type, team-lead, etc.) — this only ever
 * widens who can act, via `existingCheck || (await hasPermission(...))`, never narrows it.
 */
export async function hasPermission(
  userId: string,
  permissionKey: PermissionKey,
  projectId?: string
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("has_custom_permission", {
    target_user_id: userId,
    target_permission_key: permissionKey,
    target_project_id: projectId,
  });
  return data === true;
}
