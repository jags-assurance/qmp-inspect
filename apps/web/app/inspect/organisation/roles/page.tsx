import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CUSTOM_ROLES_TABLE, CUSTOM_ROLE_PERMISSIONS_TABLE, CUSTOM_ROLE_ASSIGNMENTS_TABLE, type PermissionKey } from "@/lib/rbac/types";
import { CreateRoleForm } from "./create-role-form";
import { RoleCard, type RoleCardData } from "./role-card";

interface RoleRow {
  id: string;
  organization_id: string | null;
  name: string;
}

interface PermissionRow {
  role_id: string;
  permission_key: PermissionKey;
}

interface AssignmentRow {
  id: string;
  role_id: string;
  project_id: string | null;
  users: { full_name: string; email: string } | null;
  projects: { name: string } | null;
}

/**
 * Custom action-level RBAC (CEO ask: "custom role-based access control... team roles and
 * responsibilities evolve constantly, so the platform must easily adapt"). Additive to every
 * existing role/permission check in the app — never a replacement. Role/permission definition is
 * JAGS-Admin-only for this round (see supabase/migrations/20260918020000_custom_rbac.sql's header
 * comment on why); a role can be assigned to a client's own user, just not defined by them yet.
 */
export default async function CustomRolesPage() {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const [{ data: roles }, { data: permissionRows }, { data: assignmentRows }, { data: organizations }, { data: users }, { data: projects }] =
    await Promise.all([
      supabase.from(CUSTOM_ROLES_TABLE).select("id, organization_id, name").order("name").returns<RoleRow[]>(),
      supabase.from(CUSTOM_ROLE_PERMISSIONS_TABLE).select("role_id, permission_key").returns<PermissionRow[]>(),
      supabase
        .from(CUSTOM_ROLE_ASSIGNMENTS_TABLE)
        .select("id, role_id, project_id, users(full_name, email), projects(name)")
        .returns<AssignmentRow[]>(),
      supabase.from("organizations").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
      supabase.from("users").select("id, full_name, email").order("full_name").returns<{ id: string; full_name: string; email: string }[]>(),
      supabase.from("projects").select("id, name").order("name").returns<{ id: string; name: string }[]>(),
    ]);

  const orgNameById = new Map((organizations ?? []).map((o) => [o.id, o.name]));
  const permissionsByRole = new Map<string, Set<PermissionKey>>();
  for (const p of permissionRows ?? []) {
    const set = permissionsByRole.get(p.role_id) ?? new Set<PermissionKey>();
    set.add(p.permission_key);
    permissionsByRole.set(p.role_id, set);
  }
  const assignmentsByRole = new Map<string, AssignmentRow[]>();
  for (const a of assignmentRows ?? []) {
    const list = assignmentsByRole.get(a.role_id) ?? [];
    list.push(a);
    assignmentsByRole.set(a.role_id, list);
  }

  const roleCards: RoleCardData[] = (roles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    organizationName: r.organization_id ? (orgNameById.get(r.organization_id) ?? "Unknown organisation") : null,
    grantedPermissions: permissionsByRole.get(r.id) ?? new Set<PermissionKey>(),
    assignments: (assignmentsByRole.get(r.id) ?? []).map((a) => ({
      id: a.id,
      userName: a.users?.full_name ?? "Unknown",
      userEmail: a.users?.email ?? "",
      projectName: a.projects?.name ?? null,
    })),
  }));

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Custom roles</h1>
      <p className="mt-1 text-sm text-muted">
        Grant a specific person a bundle of real permissions without promoting them to Admin or
        inventing a new hardcoded role — additional to whatever access they already have via staff
        role, team lead, or party type, never a replacement. A JAGS-global role can be assigned to any
        JAGS staff member; a role scoped to one client organisation can be assigned to that client&apos;s
        own users too.
      </p>

      <CreateRoleForm organizations={organizations ?? []} />

      <div className="mt-8 space-y-4">
        {roleCards.map((role) => (
          <RoleCard key={role.id} role={role} users={users ?? []} projects={projects ?? []} />
        ))}
        {roleCards.length === 0 && <p className="text-sm text-muted">No custom roles yet — create the first one above.</p>}
      </div>
    </div>
  );
}
