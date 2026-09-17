import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Whether `userId` is a lead of `teamId` specifically — mirrors the DB's is_team_lead_of() SQL
 * function used inside RLS (see the teams migration), but re-checked here at the application layer
 * for actions that must not rely on RLS alone (e.g. reassignSignoffPartyAction in
 * lib/signoff/actions.ts, a sensitive reassignment capability).
 */
export async function isTeamLeadOf(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  teamId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("is_team_lead", true)
    .maybeSingle();

  return !!data;
}

/**
 * Whether `userId` leads ANY team currently assigned to `projectId` — the check that gates
 * reassignSignoffPartyAction (a team lead may reassign a party's linked user only on a project
 * their team is actually responsible for) and that decides whether the "Reassign" affordance and
 * the Teams nav item show up for a non-Admin staff account.
 */
export async function isTeamLeadForProject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  projectId: string
): Promise<boolean> {
  const { data: assignments } = await supabase
    .from("team_project_assignments")
    .select("team_id")
    .eq("project_id", projectId);

  const teamIds = (assignments ?? []).map((a) => a.team_id);
  if (teamIds.length === 0) return false;

  const { data: leadRows } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .eq("is_team_lead", true)
    .in("team_id", teamIds);

  return (leadRows ?? []).length > 0;
}

/** Whether `userId` leads any team at all — used to decide whether the Teams nav item shows up. */
export async function isLeadOfAnyTeam(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .eq("is_team_lead", true)
    .limit(1);

  return (data ?? []).length > 0;
}
