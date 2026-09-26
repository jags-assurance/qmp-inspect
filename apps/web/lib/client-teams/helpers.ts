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
