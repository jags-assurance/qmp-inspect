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
 * Whether `organizationId` is self_managed — the tier that gets the "create your first client team"
 * bootstrap capability (mirrors can_bootstrap_client_team()'s engagement_scope check at the DB
 * layer). A full_service client never sees the create-team affordance; their teams (if any) are set
 * up by JAGS during onboarding.
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

  return data?.engagement_scope === "self_managed";
}
