// Server-only directory lookups for NCR / punch recipients and pickers (S5-02).
//
// RLS lets a non-staff caller read only their own users / access_grants / custom-role rows, so
// resolving "who should be told" or "who can be assigned" as the caller returned just the caller.
// These helpers read through the service-role client when it is configured, and ONLY return ids and
// display names scoped to one project (never raw rows). Callers must already have proven the user
// can see the project/NCR through their own RLS-bound client. Without a service key they fall back
// to the caller's own client (the previous, narrower behaviour).
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

export function directoryClient(fallback: AnyClient): AnyClient {
  if (isServiceRoleConfigured()) {
    try {
      return createSupabaseServiceRoleClient() as AnyClient;
    } catch {
      // fall through
    }
  }
  return fallback;
}

interface GrantRow {
  user_id: string;
  scope_type: "global" | "organization" | "project";
  organization_id: string | null;
  project_id: string | null;
}

/** Active users with access to a project (grants + linked party logins + party members), id and name only. */
export async function projectPeople(
  fallback: AnyClient,
  projectId: string,
  organizationId: string | null
): Promise<{ id: string; name: string }[]> {
  const db = directoryClient(fallback);
  const [{ data: grants }, { data: parties }] = await Promise.all([
    db.from("access_grants").select("user_id, scope_type, organization_id, project_id").returns<GrantRow[]>(),
    db.from("project_parties").select("id, user_id").eq("project_id", projectId).eq("is_active", true),
  ]);
  const ids = new Set<string>();
  for (const g of grants ?? []) {
    if (g.scope_type === "global") ids.add(g.user_id);
    else if (g.scope_type === "organization" && g.organization_id === organizationId) ids.add(g.user_id);
    else if (g.scope_type === "project" && g.project_id === projectId) ids.add(g.user_id);
  }
  const partyIds: string[] = [];
  for (const p of (parties ?? []) as { id: string; user_id: string | null }[]) {
    partyIds.push(p.id);
    if (p.user_id) ids.add(p.user_id);
  }
  if (partyIds.length > 0) {
    const { data: members } = await db.from("project_party_members").select("user_id").in("project_party_id", partyIds).not("user_id", "is", null);
    for (const m of (members ?? []) as { user_id: string | null }[]) if (m.user_id) ids.add(m.user_id);
  }
  if (ids.size === 0) return [];
  const { data: users } = await db
    .from("users")
    .select("id, full_name, email")
    .in("id", [...ids])
    .eq("is_active", true)
    .returns<{ id: string; full_name: string; email: string }[]>();
  return (users ?? []).map((u) => ({ id: u.id, name: u.full_name || u.email })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Does this user have access to the project (used to validate an assignee)? */
export async function userHasProjectAccess(fallback: AnyClient, userId: string, projectId: string, organizationId: string): Promise<boolean> {
  const db = directoryClient(fallback);
  const [{ data: grants }, { data: parties }, { data: memberRows }] = await Promise.all([
    db.from("access_grants").select("scope_type, organization_id, project_id").eq("user_id", userId).returns<Omit<GrantRow, "user_id">[]>(),
    db.from("project_parties").select("id").eq("project_id", projectId).eq("user_id", userId).limit(1),
    db.from("project_party_members").select("project_party_id, project_parties!inner(project_id)").eq("user_id", userId).eq("project_parties.project_id", projectId).limit(1),
  ]);
  return (
    (grants ?? []).some(
      (g) =>
        g.scope_type === "global" ||
        (g.scope_type === "organization" && g.organization_id === organizationId) ||
        (g.scope_type === "project" && g.project_id === projectId)
    ) ||
    (parties ?? []).length > 0 ||
    (memberRows ?? []).length > 0
  );
}

/** Admin-level JAGS staff (null staff_role counts as admin) who can verify / close, org-scoped by grants. */
export async function staffVerifierIds(fallback: AnyClient): Promise<string[]> {
  const db = directoryClient(fallback);
  const { data } = await db
    .from("users")
    .select("id, staff_role")
    .eq("is_jags_staff", true)
    .eq("is_active", true)
    .returns<{ id: string; staff_role: string | null }[]>();
  return (data ?? []).filter((u) => u.staff_role !== "inspector").map((u) => u.id);
}

/** Active users holding a custom-role permission on a project (project-scoped or org-wide assignment). */
export async function permissionHolderIds(fallback: AnyClient, permissionKey: string, projectId: string): Promise<string[]> {
  try {
    const db = directoryClient(fallback);
    const { data: perms } = await db.from("custom_role_permissions").select("role_id").eq("permission_key", permissionKey);
    const roleIds = [...new Set(((perms ?? []) as { role_id: string }[]).map((p) => p.role_id))];
    if (roleIds.length === 0) return [];
    const { data: assigns } = await db.from("custom_role_assignments").select("user_id, project_id").in("role_id", roleIds);
    const ids = ((assigns ?? []) as { user_id: string; project_id: string | null }[])
      .filter((a) => a.project_id === null || a.project_id === projectId)
      .map((a) => a.user_id);
    if (ids.length === 0) return [];
    const { data: active } = await db.from("users").select("id").in("id", ids).eq("is_active", true);
    return ((active ?? []) as { id: string }[]).map((u) => u.id);
  } catch {
    return [];
  }
}

/** The responsible party's login plus its team members. */
export async function partyUserIds(fallback: AnyClient, partyId: string | null | undefined): Promise<string[]> {
  if (!partyId) return [];
  const db = directoryClient(fallback);
  const out = new Set<string>();
  const { data: party } = await db.from("project_parties").select("user_id").eq("id", partyId).maybeSingle<{ user_id: string | null }>();
  if (party?.user_id) out.add(party.user_id);
  const { data: members } = await db.from("project_party_members").select("user_id").eq("project_party_id", partyId).not("user_id", "is", null);
  for (const m of (members ?? []) as { user_id: string | null }[]) if (m.user_id) out.add(m.user_id);
  return [...out];
}

/** Display names for user ids (history / audit trail), readable by any project member. */
export async function userNames(fallback: AnyClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const db = directoryClient(fallback);
  const { data } = await db.from("users").select("id, full_name, email").in("id", unique);
  for (const u of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) out.set(u.id, u.full_name || u.email || "");
  return out;
}
