"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isClientTeamLeadOf } from "./helpers";

export interface ClientTeamActionState {
  error: string | null;
}

const CLIENT_TEAMS_PATH = "/inspect/organisation/client-teams";

/**
 * Creates the client's own team row. Allowed for a JAGS Admin (onboarding on the client's behalf),
 * or — the bootstrap case — any user with access to a self_managed organization that has no
 * client_teams row yet (can_bootstrap_client_team() in the migration). A full_service org never
 * reaches this path client-side (the page itself doesn't render the create form for one), but RLS is
 * the real gate either way, so this action only surfaces a clearer error than a raw 42501 would.
 */
export async function createClientTeamAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!organizationId || !name) return { error: "Organisation and team name are required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("client_teams").insert({ organization_id: organizationId, name });

  if (error) {
    return {
      error: "Could not create the team. Either you don't have permission, or this organisation already has a team (only a JAGS Admin or an existing team lead can add another).",
    };
  }

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}

/**
 * Shared authorization for every membership/assignment write below: an Admin, a lead of THAT
 * SPECIFIC team, or — while the team has no lead yet (right after a self_managed org's bootstrap
 * creation) — anyone with access to that team's (self_managed) organization, mirroring
 * can_bootstrap_client_team_members() in RLS. Re-checked here so a blocked attempt gets a clear
 * message instead of a raw permission-denied error, same reasoning as lib/teams/actions.ts.
 */
async function requireClientTeamWriteAccess(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  clientTeamId: string
): Promise<string | null> {
  const session = await requireSession();
  if (isAdminStaff(session)) return null;
  if (await isClientTeamLeadOf(supabase, userId, clientTeamId)) return null;

  // Bootstrap: this team has no lead yet — mirror can_bootstrap_client_team_members() rather than
  // re-deriving it, so RLS remains the single source of truth and this is just a nicer error message.
  const { data: leadRows } = await supabase
    .from("client_team_members")
    .select("client_team_id")
    .eq("client_team_id", clientTeamId)
    .eq("is_team_lead", true)
    .limit(1);
  if ((leadRows ?? []).length === 0) return null;

  return "Only a JAGS Admin, or this team's own lead, can manage it.";
}

export async function addClientTeamMemberAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const clientTeamId = String(formData.get("client_team_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  const isTeamLead = formData.get("is_team_lead") === "on";
  if (!clientTeamId || !userId) return { error: "Team and member are required." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const authError = await requireClientTeamWriteAccess(supabase, session.userId, clientTeamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("client_team_members")
    .insert({ client_team_id: clientTeamId, user_id: userId, is_team_lead: isTeamLead });

  if (error) {
    return {
      error: error.code === "23505" ? "That person is already on this team." : "Could not add the member.",
    };
  }

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}

export async function removeClientTeamMemberAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const clientTeamId = String(formData.get("client_team_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  if (!clientTeamId || !userId) return { error: "Missing team or member." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const authError = await requireClientTeamWriteAccess(supabase, session.userId, clientTeamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("client_team_members")
    .delete()
    .eq("client_team_id", clientTeamId)
    .eq("user_id", userId);
  if (error) return { error: "Could not remove the member." };

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}

/** Promotes/demotes a member's is_team_lead flag on their own team. */
export async function setClientTeamLeadAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const clientTeamId = String(formData.get("client_team_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  const isTeamLead = formData.get("is_team_lead") === "on";
  if (!clientTeamId || !userId) return { error: "Missing team or member." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const authError = await requireClientTeamWriteAccess(supabase, session.userId, clientTeamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("client_team_members")
    .update({ is_team_lead: isTeamLead })
    .eq("client_team_id", clientTeamId)
    .eq("user_id", userId);
  if (error) return { error: "Could not update the lead flag." };

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}

export async function assignClientTeamToProjectAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const clientTeamId = String(formData.get("client_team_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!clientTeamId || !projectId) return { error: "Team and project are required." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const authError = await requireClientTeamWriteAccess(supabase, session.userId, clientTeamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("client_team_project_assignments")
    .insert({ client_team_id: clientTeamId, project_id: projectId });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "This team is already assigned to that project."
          : "Could not assign the project. It must belong to this team's own organisation.",
    };
  }

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}

export async function unassignClientTeamFromProjectAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const clientTeamId = String(formData.get("client_team_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!clientTeamId || !projectId) return { error: "Missing team or project." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const authError = await requireClientTeamWriteAccess(supabase, session.userId, clientTeamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("client_team_project_assignments")
    .delete()
    .eq("client_team_id", clientTeamId)
    .eq("project_id", projectId);
  if (error) return { error: "Could not unassign the project." };

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}
