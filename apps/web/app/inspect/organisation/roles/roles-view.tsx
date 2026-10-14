import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CUSTOM_ROLES_TABLE, CUSTOM_ROLE_PERMISSIONS_TABLE, CUSTOM_ROLE_ASSIGNMENTS_TABLE, type PermissionKey } from "@/lib/rbac/types";
import { getSelfManagedOrgIdsForUser, getClientManagedOrgIdsForUser } from "@/lib/rbac/access";
import { CreateRoleForm } from "./create-role-form";
import { RoleCard, type RoleCardData } from "./role-card";
import { PageGuide } from "@/components/domain/page-guide";
import { StatCard } from "@/components/ui/stat-card";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";
import { MoreDetails } from "@/components/domain/more-details";

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
 * existing role/permission check in the app — never a replacement.
 *
 * Role/permission definition used to be JAGS-Admin-only; widened by
 * supabase/migrations/20260919030000_self_managed_custom_role_management.sql so a Self-Managed
 * client (organizations.engagement_scope = 'self_managed') can also define, edit and assign roles
 * SCOPED TO ITS OWN organisation. Unlike the Admin view below (which sees every org's roles and gets
 * an org picker on the create form), a self-managed client only ever sees its own organisation's
 * roles — there is no cross-org picker for them, and the create form is pre-scoped to their org.
 */
export async function CustomRolesView({ embedded }: { embedded?: boolean }) {
  const tl = await getTranslator();
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const admin = isAdminStaff(session);

  let selfManagedOrgIds: string[] = [];
  let clientManagedOrgIds = new Set<string>();
  if (!admin) {
    selfManagedOrgIds = Array.from(await getSelfManagedOrgIdsForUser(supabase, session.userId));
    if (selfManagedOrgIds.length === 0) redirect("/inspect");
    clientManagedOrgIds = await getClientManagedOrgIdsForUser(supabase, session.userId);
  }

  const [{ data: roles }, { data: permissionRows }, { data: assignmentRows }, { data: organizations }, { data: projects }] = await Promise.all([
    admin
      ? supabase.from(CUSTOM_ROLES_TABLE).select("id, organization_id, name").order("name").returns<RoleRow[]>()
      : supabase.from(CUSTOM_ROLES_TABLE).select("id, organization_id, name").in("organization_id", selfManagedOrgIds).order("name").returns<RoleRow[]>(),
    supabase.from(CUSTOM_ROLE_PERMISSIONS_TABLE).select("role_id, permission_key").returns<PermissionRow[]>(),
    supabase
      .from(CUSTOM_ROLE_ASSIGNMENTS_TABLE)
      .select("id, role_id, project_id, users(full_name, email), projects(name)")
      .returns<AssignmentRow[]>(),
    admin
      ? supabase.from("organizations").select("id, name").order("name").returns<{ id: string; name: string }[]>()
      : supabase.from("organizations").select("id, name").in("id", selfManagedOrgIds).returns<{ id: string; name: string }[]>(),
    admin
      ? supabase.from("projects").select("id, name").order("name").returns<{ id: string; name: string }[]>()
      : supabase.from("projects").select("id, name").in("organization_id", selfManagedOrgIds).order("name").returns<{ id: string; name: string }[]>(),
  ]);

  // Users the "assign" picker offers: for the Admin view, everyone; for a self-managed client, only
  // people who actually have access to one of their own orgs (mirrors the
  // custom_role_assignments_self_managed_write RLS check that the assigned user must have an
  // access_grants row in that org — no point offering someone the write would reject anyway).
  let users: { id: string; full_name: string; email: string }[] = [];
  if (admin) {
    const { data } = await supabase.from("users").select("id, full_name, email").order("full_name").returns<
      { id: string; full_name: string; email: string }[]
    >();
    users = data ?? [];
  } else {
    const { data: grants } = await supabase
      .from("access_grants")
      .select("user_id, users(id, full_name, email)")
      .in("organization_id", selfManagedOrgIds)
      .returns<{ user_id: string; users: { id: string; full_name: string; email: string } | null }[]>();
    const seen = new Set<string>();
    for (const g of grants ?? []) {
      const u = g.users;
      if (u && !seen.has(u.id)) {
        seen.add(u.id);
        users.push(u);
      }
    }
    users.sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

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
    organizationId: r.organization_id,
    organizationName: r.organization_id ? (orgNameById.get(r.organization_id) ?? "Unknown organisation") : null,
    grantedPermissions: permissionsByRole.get(r.id) ?? new Set<PermissionKey>(),
    assignments: (assignmentsByRole.get(r.id) ?? []).map((a) => ({
      id: a.id,
      userName: a.users?.full_name ?? "Unknown",
      userEmail: a.users?.email ?? "",
      projectName: a.projects?.name ?? null,
    })),
  }));

  const totalAssignments = (assignmentRows ?? []).length;
  const distinctPermissionsGranted = new Set((permissionRows ?? []).map((p) => p.permission_key)).size;

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink"><T>Custom roles</T></Heading>
        <PageGuide
          title={tl("Custom roles — how this works")}
          points={[
            "A role is a named bundle of specific permissions from a fixed set (e.g. \"add a project party\", \"approve an ITP\") — pick exactly which ones when you create it.",
            "Assigning a role to someone ADDS to their access — it never replaces what their staff role, team lead status, or party type already grants them.",
            admin
              ? "As Admin, you can create a JAGS-global role (assignable to any JAGS staff member) or a role scoped to one client organisation (assignable to that client's own users), and you can grant any of the 12 permission keys."
              : "Roles you create here are scoped to your own organisation only — your own people, your own projects. Self-Managed orgs can only self-grant add_project_party, reassign_project_party and view_org_reports; Full Client-Managed orgs can additionally self-grant approve_itp and provision_party_login.",
            "manage_intervention_levels, issue_irn, close_ncr, approve_vault_document, close_punch_item and issue_handover stay JAGS-Admin-grantable only on every tier — a client can revoke one of these from a role if a JAGS Admin already granted it, but can never grant it themselves.",
            "A role can optionally be narrowed to one specific project when you assign it, instead of the whole organisation.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted"><T>Give a person extra permissions on top of their normal access.</T></p>
      <MoreDetails className="mt-1">
        <p><T>Grant a specific person a bundle of real permissions without promoting them to Admin or inventing a new hardcoded role — additional to whatever access they already have via staff role, team lead, or party type, never a replacement.</T>
        {admin
          ? " A JAGS-global role can be assigned to any JAGS staff member; a role scoped to one client organisation can be assigned to that client's own users too."
          : " Roles you create here are scoped to your own organisation only — your own people, your own projects. Which permissions you can self-grant depends on your org's engagement tier (Self-Managed vs Full Client-Managed)."}</p>
      </MoreDetails>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Custom roles" value={roleCards.length} />
        <StatCard label="Assignments" value={totalAssignments} />
        <StatCard label="Distinct permission keys in use" value={distinctPermissionsGranted} />
        <StatCard label="People with a role" value={new Set((assignmentRows ?? []).map((a) => a.users?.email ?? a.id)).size} />
      </div>

      <div className="mt-6">
        <CreateRoleForm organizations={organizations ?? []} lockedOrganizationId={admin ? null : selfManagedOrgIds[0]} />
      </div>

      <div className="mt-8 space-y-4">
        {roleCards.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            users={users}
            projects={projects ?? []}
            restrictGrantableKeys={!admin}
            isClientManagedOrg={!!role.organizationId && clientManagedOrgIds.has(role.organizationId)}
          />
        ))}
        {roleCards.length === 0 && <p className="text-sm text-muted"><T>No custom roles yet — create the first one above.</T></p>}
      </div>
    </div>
  );
}
