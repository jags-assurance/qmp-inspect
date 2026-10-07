// Deliberately NOT "use server": a plain helper shared by the engagement-scope action and the numbering
// settings page. (Exporting it from a "use server" file would make it a callable Server Action.)

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { CLIENT_MANAGED_ONLY_PERMISSION_KEYS } from "@/lib/rbac/types";

/**
 * How many custom-role permissions that only exist on Full Client-Managed (approve ITP, create logins,
 * run standalone) are granted in this organisation. Null when the organisation is not on that tier,
 * so there is nothing to revoke. Runs under the caller's own RLS.
 */
export async function countTierOnlyPermissions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string,
  scope: string
): Promise<number | null> {
  if (scope !== "client_managed") return null;
  const { data: roles } = await supabase.from("custom_roles").select("id").eq("organization_id", organizationId).returns<{ id: string }[]>();
  const roleIds = (roles ?? []).map((r) => r.id);
  if (roleIds.length === 0) return 0;
  const { count } = await supabase
    .from("custom_role_permissions")
    .select("role_id", { count: "exact", head: true })
    .in("role_id", roleIds)
    .in("permission_key", [...CLIENT_MANAGED_ONLY_PERMISSION_KEYS]);
  return count ?? 0;
}
