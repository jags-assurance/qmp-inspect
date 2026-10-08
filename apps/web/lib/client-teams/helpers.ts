import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Whether `userId` is a lead of `clientTeamId` specifically — mirrors the DB's
 * is_client_team_lead_of() SQL function used inside RLS (see the client_teams migration), the
 * client-org analogue of lib/teams/helpers.ts's isTeamLeadOf() for JAGS teams. Re-checked here at
 * the application layer so a blocked write gets a clear message instead of a raw permission-denied
 * error, same reasoning as the JAGS-team helpers.
 */
export async function isClientTeamLeadOf(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  clientTeamId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("client_team_members")
    .select("client_team_id")
    .eq("client_team_id", clientTeamId)
    .eq("user_id", userId)
    .eq("is_team_lead", true)
    .maybeSingle();

  return !!data;
}

/**
 * Whether `userId` leads ANY client team currently assigned to `projectId` — the client-team
 * analogue of lib/teams/helpers.ts's isTeamLeadForProject(). Until this existed,
 * client_team_project_assignments (set from the "Assign to project" control on the Client Teams
 * page) was write-only: the row was inserted and displayed back on that same admin page, but
 * nothing else in the app ever read it — "assigning" a team to a project had no actual effect. This
 * is what gives that assignment a real consequence: it's what reassignSignoffPartyAction and the
 * project page's reassign affordance check for a client-side party, mirroring exactly how a JAGS
 * team's project assignment already gates the same capability for staff.
 */
export async function isClientTeamLeadForProject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  projectId: string
): Promise<boolean> {
  const { data: assignments } = await supabase
    .from("client_team_project_assignments")
    .select("client_team_id")
    .eq("project_id", projectId);

  const teamIds = (assignments ?? []).map((a) => a.client_team_id);
  if (teamIds.length === 0) return false;

  const { data: leadRows } = await supabase
    .from("client_team_members")
    .select("client_team_id")
    .eq("user_id", userId)
    .eq("is_team_lead", true)
    .in("client_team_id", teamIds);

  return (leadRows ?? []).length > 0;
}

/** Whether `userId` leads any client team at all, within any organization. */
export async function isLeadOfAnyClientTeam(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("client_team_members")
    .select("client_team_id")
    .eq("user_id", userId)
    .eq("is_team_lead", true)
    .limit(1);

  return (data ?? []).length > 0;
}

/**
 * Whether `organizationId` is self_managed OR client_managed — both tiers get the "create your
 * first client team" bootstrap capability (mirrors can_bootstrap_client_team()'s engagement_scope
 * check at the DB layer, widened in 20260930050000_client_managed_engagement_scope.sql). A
 * full_service client never sees the create-team affordance; their teams (if any) are set up by
 * JAGS during onboarding.
 */
export async function isSelfManagedOrg(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organizationId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("organizations")
    .select("engagement_scope")
    .eq("id", organizationId)
    .maybeSingle();

  return data?.engagement_scope === "self_managed" || data?.engagement_scope === "client_managed";
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * B7: grants `userId` project-scoped platform access (role 'member') to each of `projectIds` in
 * `organizationId` — the only access a client team member gets, so a member reaches just the projects
 * their team is assigned to instead of every project in the organisation. A duplicate (23505, they
 * already hold a grant for that project) is fine; the first other failure is returned, remaining
 * projects are still attempted so one bad row doesn't strand the rest. Never deletes or widens anything.
 */
export async function grantClientTeamMemberProjectAccess(
  supabase: ServerClient,
  params: { userId: string; organizationId: string; projectIds: string[] }
): Promise<{ error: { code?: string; message: string } | null; granted: string[] }> {
  let firstError: { code?: string; message: string } | null = null;
  const granted: string[] = [];
  for (const projectId of params.projectIds) {
    const { error } = await supabase.from("access_grants").insert({
      user_id: params.userId,
      scope_type: "project",
      organization_id: params.organizationId,
      project_id: projectId,
      role: "member",
    });
    if (!error) granted.push(projectId);
    else if (error.code !== "23505" && !firstError) firstError = { code: error.code, message: error.message };
  }
  return { error: firstError, granted };
}

/** Project ids the client team is currently assigned to. */
export async function listClientTeamProjectIds(supabase: ServerClient, clientTeamId: string): Promise<string[]> {
  const { data } = await supabase
    .from("client_team_project_assignments")
    .select("project_id")
    .eq("client_team_id", clientTeamId);
  return (data ?? []).map((row) => row.project_id);
}

/** User ids of every member of the client team. */
export async function listClientTeamMemberIds(supabase: ServerClient, clientTeamId: string): Promise<string[]> {
  const { data } = await supabase.from("client_team_members").select("user_id").eq("client_team_id", clientTeamId);
  return (data ?? []).map((row) => row.user_id);
}
