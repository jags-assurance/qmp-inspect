import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isModuleLicensed } from "@/lib/module-licensing/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OrgPickerForm } from "../numbering/org-picker-form";
import { CreateClientTeamForm } from "./create-client-team-form";
import { ClientTeamCard, type ClientTeamCardData, type UserOption, type ProjectOption } from "./client-team-card";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

interface OrganizationOption {
  id: string;
  name: string;
  engagement_scope: string;
}

interface MemberJoinRow {
  client_team_id: string;
  user_id: string;
  is_team_lead: boolean;
  users: { id: string; full_name: string; email: string } | null;
}

interface AssignmentJoinRow {
  client_team_id: string;
  project_id: string;
  projects: { id: string; name: string } | null;
}

/**
 * A client organization's own analogue of the JAGS-internal Teams page (see
 * app/inspect/organisation/teams/page.tsx) — grouping the CLIENT'S OWN people (not JAGS staff) into
 * named teams for their own internal organisation of who's responsible for what, scoped to their own
 * org's own projects. Deliberately a separate table/page from JAGS teams, not a widened version of
 * it — see supabase/migrations/20260919020000_client_teams.sql for why.
 *
 * A JAGS Admin can browse any organisation's client teams (same org-picker pattern as
 * organisation/branding and organisation/plans). A non-staff user only ever sees their own
 * organisation, with no picker — derived from their access_grants, same as other org-scoped pages.
 */
export async function ClientTeamsView({ searchParams, embedded }: {
  searchParams: { org?: string };
  embedded?: boolean;
}) {
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  const admin = isAdminStaff(session);
  const supabase = await createSupabaseServerClient();

  let organizationId: string | null = null;
  let orgPicker: { organizations: { id: string; name: string }[]; selectedOrgId: string | null } | null = null;
  let selectedOrg: OrganizationOption | null = null;

  if (admin) {
    const { org: orgIdParam } = searchParams;
    const { data: organizations } = await supabase
      .from("organizations")
      .select("id, name, engagement_scope")
      .order("name")
      .returns<OrganizationOption[]>();

    selectedOrg = organizations?.find((o) => o.id === orgIdParam) ?? organizations?.[0] ?? null;
    organizationId = selectedOrg?.id ?? null;
    orgPicker = {
      organizations: (organizations ?? []).map((o) => ({ id: o.id, name: o.name })),
      selectedOrgId: organizationId,
    };
  } else {
    // A client user's own organisation: the first organisation- or project-scoped access grant
    // carries organization_id (see has_org_access()'s own scoping and lib/auth/session.ts).
    organizationId = session.grants.find((g) => g.organization_id)?.organization_id ?? null;
    if (!organizationId) redirect("/inspect");

    const { data: org } = await supabase
      .from("organizations")
      .select("id, name, engagement_scope")
      .eq("id", organizationId)
      .maybeSingle<OrganizationOption>();
    selectedOrg = org ?? null;
  }

  if (!organizationId || !selectedOrg) {
    return (
      <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
        <Heading className="text-2xl font-semibold text-ink">Client Teams</Heading>
        <p className="mt-1 text-sm text-muted">No organisation found.</p>
      </div>
    );
  }

  if (!admin && !(await isModuleLicensed(supabase, organizationId, "client_teams"))) {
    return (
      <div className={embedded ? undefined : "max-w-4xl"}>
        <Heading className="text-2xl font-semibold text-ink">Client Teams</Heading>
        <p className="mt-1 text-sm text-muted">This module isn&apos;t included in your organisation&apos;s plan. Ask a JAGS Admin to enable it.</p>
      </div>
    );
  }

  const [{ data: teams }, { data: memberRows }, { data: assignmentRows }, { data: orgProjects }] = await Promise.all([
    supabase.from("client_teams").select("id, name, created_at").eq("organization_id", organizationId).order("name"),
    supabase
      .from("client_team_members")
      .select("client_team_id, user_id, is_team_lead, users(id, full_name, email)")
      .returns<MemberJoinRow[]>(),
    supabase
      .from("client_team_project_assignments")
      .select("client_team_id, project_id, projects(id, name)")
      .returns<AssignmentJoinRow[]>(),
    supabase.from("projects").select("id, name").eq("organization_id", organizationId).order("name").returns<ProjectOption[]>(),
  ]);

  const teamIds = new Set((teams ?? []).map((t) => t.id));
  const relevantMembers = (memberRows ?? []).filter((r) => teamIds.has(r.client_team_id));
  const relevantAssignments = (assignmentRows ?? []).filter((r) => teamIds.has(r.client_team_id));

  // Eligible members: anyone whose access already reaches this organisation or its own projects
  // (organisation/project-scoped access_grants). Deliberately NOT the same "OR global scope" set the
  // JAGS-side reassign/responsible-person pickers use — this page's own header text says "a client
  // team only ever contains this organisation's own people", and a `global` access_grants row is
  // exclusively how JAGS staff reach every tenant (see lib/auth/session.ts / phase0_tenancy_schema.
  // sql), so including it here was a real bug: a JAGS inspector's own scoped/global grant could show
  // up as an "addable" client team member. Also filters out is_jags_staff directly (not just by
  // grant scope), in case a staff account additionally holds an org/project-scoped grant too.
  const orgProjectIds = (orgProjects ?? []).map((p) => p.id);
  const orFilter = [
    `organization_id.eq.${organizationId}`,
    ...(orgProjectIds.length > 0 ? [`project_id.in.(${orgProjectIds.join(",")})`] : []),
  ].join(",");
  const { data: grantedUserIds } = await supabase.from("access_grants").select("user_id").or(orFilter);
  const userIds = Array.from(new Set((grantedUserIds ?? []).map((g) => g.user_id)));
  let eligibleUsers: UserOption[] = [];
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name, email, is_jags_staff")
      .in("id", userIds)
      .eq("is_jags_staff", false)
      .order("full_name")
      .returns<(UserOption & { is_jags_staff: boolean })[]>();
    eligibleUsers = users ?? [];
  }

  const membersByTeam = new Map<string, MemberJoinRow[]>();
  for (const row of relevantMembers) {
    const list = membersByTeam.get(row.client_team_id) ?? [];
    list.push(row);
    membersByTeam.set(row.client_team_id, list);
  }

  const assignmentsByTeam = new Map<string, AssignmentJoinRow[]>();
  for (const row of relevantAssignments) {
    const list = assignmentsByTeam.get(row.client_team_id) ?? [];
    list.push(row);
    assignmentsByTeam.set(row.client_team_id, list);
  }

  const myLeadTeamIds = new Set(
    relevantMembers.filter((r) => r.user_id === session.userId && r.is_team_lead).map((r) => r.client_team_id)
  );

  // Bootstrap: a team with no lead yet, in a self_managed org, is manageable by anyone who reaches
  // this page for that org (mirrors can_bootstrap_client_team_members() in RLS) — lets the person who
  // just created the org's first team add themselves (or anyone else) as its first member/lead.
  const isSelfManaged = selectedOrg.engagement_scope === "self_managed" || selectedOrg.engagement_scope === "client_managed";
  const teamHasNoLead = (teamId: string) => !(membersByTeam.get(teamId) ?? []).some((m) => m.is_team_lead);

  const teamCards: ClientTeamCardData[] = (teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    canManage: admin || myLeadTeamIds.has(t.id) || (isSelfManaged && teamHasNoLead(t.id)),
    members: (membersByTeam.get(t.id) ?? []).map((m) => ({
      userId: m.user_id,
      fullName: m.users?.full_name ?? "Unknown",
      email: m.users?.email ?? "",
      isTeamLead: m.is_team_lead,
    })),
    assignedProjects: (assignmentsByTeam.get(t.id) ?? []).map((a) => ({
      projectId: a.project_id,
      name: a.projects?.name ?? "Unknown project",
    })),
  }));

  // The create form is offered to an Admin (setting up teams on the client's behalf) or, for the
  // bootstrap case, any user reaching this org's page while it's self_managed and has no team yet —
  // matches can_bootstrap_client_team() in RLS exactly.
  const canCreateTeam = admin || (isSelfManaged && (teams ?? []).length === 0);

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="flex flex-wrap items-center gap-2">
        <Heading className="text-2xl font-semibold text-ink">Client Teams</Heading>
        <PageGuide
          title="Client Teams — how this works"
          points={[
            "Who can ADD a member: a JAGS Admin (any organisation), or that team's own team lead (their team only). A Self-Managed or Full Client-Managed org's first user can also bootstrap its very first team before any lead exists yet.",
            "Add someone by picking from people who already have platform access to this organisation or its projects, or by entering their email directly if they have a JAGS Assurance account but aren't yet on any project — the email must already have an account; if not, provision their login first from that project's own page (Provision login).",
            "A client team only ever contains this organisation's own people, and can only be assigned to this organisation's own projects — it's a separate, parallel structure to JAGS's internal Teams page.",
            "Assigning a team to a project doesn't grant access by itself — each member still needs their own access_grant to that project; the assignment is how this page groups \"who's responsible for what\".",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        This organisation&apos;s own groupings of its people — who&apos;s on which team, who leads
        it, and which of this organisation&apos;s own projects that team is responsible for. Separate
        from JAGS&apos;s internal Teams: a client team only ever contains this organisation&apos;s own
        people and can only be assigned to this organisation&apos;s own projects. A team lead can
        manage their own team&apos;s membership and project assignments; a JAGS Admin can manage
        every organisation&apos;s teams.
      </p>

      {admin && orgPicker && <OrgPickerForm organizations={orgPicker.organizations} selectedOrgId={orgPicker.selectedOrgId} />}

      {canCreateTeam && <CreateClientTeamForm organizationId={organizationId} />}

      <div className="mt-8 space-y-6">
        {teamCards.map((team) => (
          <ClientTeamCard key={team.id} team={team} users={eligibleUsers} projects={orgProjects ?? []} />
        ))}
        {teamCards.length === 0 && <p className="text-sm text-muted">No teams yet.</p>}
      </div>
    </div>
  );
}
