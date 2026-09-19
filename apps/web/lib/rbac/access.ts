import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CUSTOM_ROLES_TABLE } from "./types";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Every self_managed organisation `userId` has an access grant into — the same "any org this
 * user's access reaches, filtered to engagement_scope = 'self_managed'" shape as
 * app/inspect/projects/new/page.tsx uses for project creation, reused here for custom-role
 * definition (supabase/migrations/20260919030000_self_managed_custom_role_management.sql). Empty
 * for a JAGS staff member or a full_service-only client — the app-layer gate for "can this person
 * define their own custom roles at all".
 */
export async function getSelfManagedOrgIdsForUser(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data: grants } = await supabase
    .from("access_grants")
    .select("organization_id, organizations(id, engagement_scope)")
    .eq("user_id", userId)
    .returns<{ organization_id: string | null; organizations: { id: string; engagement_scope: string } | null }[]>();

  const ids = new Set<string>();
  for (const g of grants ?? []) {
    const org = g.organizations;
    if (org && org.engagement_scope === "self_managed") ids.add(org.id);
  }
  return ids;
}

/**
 * Resolves a custom_roles row's organization_id, for app-layer checks before an insert/update that
 * only carries the role_id (permission toggles, assignments) — mirrors the join every
 * *_self_managed_write RLS policy does against custom_roles. Returns null if the role doesn't exist
 * or is JAGS-global (organization_id is null), since a self-managed client can never touch either.
 */
export async function getClientOwnedRoleOrgId(supabase: SupabaseClient, roleId: string): Promise<string | null> {
  const { data } = await supabase
    .from(CUSTOM_ROLES_TABLE)
    .select("organization_id")
    .eq("id", roleId)
    .maybeSingle<{ organization_id: string | null }>();
  return data?.organization_id ?? null;
}
