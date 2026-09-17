import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLeadOfAnyTeam } from "@/lib/teams/helpers";
import { CreateTeamForm } from "./create-team-form";
import { TeamCard, type TeamCardData, type StaffOption, type ProjectOption } from "./team-card";

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
}

interface TeamMemberJoinRow {
  team_id: string;
  user_id: string;
  is_team_lead: boolean;
  users: { id: string; full_name: string; email: string } | null;
}

interface TeamAssignmentJoinRow {
  team_id: string;
  project_id: string;
  projects: { id: string; name: string } | null;
}

/**
 * JAGS-internal team management: who's on which team, who leads it, and which projects it's
 * responsible for. Visible to a JAGS Admin (full control over every team) or anyone who leads at
 * least one team (control over their own team's membership/assignments only) — matches the RLS
 * (teams_select is any staff, the write policies are admin-or-own-team-lead). A plain Inspector
 * with no lead role of their own has no reason to be here, same boundary as Staff Access.
 */
export default async function TeamsPage() {
  const session = await requireSession();
  if (!session.isJagsStaff) redirect("/inspect");

  const supabase = await createSupabaseServerClient();
  const admin = isAdminStaff(session);
  const leadsAnyTeam = admin ? true : await isLeadOfAnyTeam(supabase, session.userId);
  if (!admin && !leadsAnyTeam) redirect("/inspect");

  const [{ data: teams }, { data: memberRows }, { data: assignmentRows }, { data: staff }, { data: projects }] =
    await Promise.all([
      supabase.from("teams").select("id, name, created_at").order("name"),
      supabase
        .from("team_members")
        .select("team_id, user_id, is_team_lead, users(id, full_name, email)")
        .returns<TeamMemberJoinRow[]>(),
      supabase
        .from("team_project_assignments")
        .select("team_id, project_id, projects(id, name)")
        .returns<TeamAssignmentJoinRow[]>(),
      supabase.from("users").select("id, full_name, email").eq("is_jags_staff", true).order("full_name").returns<StaffRow[]>(),
      supabase.from("projects").select("id, name").order("name").returns<ProjectOption[]>(),
    ]);

  const membersByTeam = new Map<string, TeamMemberJoinRow[]>();
  for (const row of memberRows ?? []) {
    const list = membersByTeam.get(row.team_id) ?? [];
    list.push(row);
    membersByTeam.set(row.team_id, list);
  }

  const assignmentsByTeam = new Map<string, TeamAssignmentJoinRow[]>();
  for (const row of assignmentRows ?? []) {
    const list = assignmentsByTeam.get(row.team_id) ?? [];
    list.push(row);
    assignmentsByTeam.set(row.team_id, list);
  }

  const myLeadTeamIds = new Set(
    (memberRows ?? []).filter((r) => r.user_id === session.userId && r.is_team_lead).map((r) => r.team_id)
  );

  const staffOptions: StaffOption[] = (staff ?? []).map((s) => ({ id: s.id, full_name: s.full_name, email: s.email }));

  const teamCards: TeamCardData[] = (teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    canManage: admin || myLeadTeamIds.has(t.id),
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

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Teams</h1>
      <p className="mt-1 text-sm text-muted">
        JAGS-internal staff groupings — which staff belong to which team, who leads it, and which
        projects that team is responsible for. A team lead can manage their own team&apos;s
        membership and project assignments; a JAGS Admin can manage every team.
      </p>

      {admin && <CreateTeamForm />}

      <div className="mt-8 space-y-6">
        {teamCards.map((team) => (
          <TeamCard key={team.id} team={team} staff={staffOptions} projects={projects ?? []} />
        ))}
        {teamCards.length === 0 && <p className="text-sm text-muted">No teams yet.</p>}
      </div>
    </div>
  );
}
