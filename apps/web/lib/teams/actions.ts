"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { isTeamLeadOf } from "./helpers";

export interface TeamActionState {
  error: string | null;
}

const TEAMS_PATH = "/inspect/organisation/teams";

/** Only an Admin creates a team — a team lead manages an existing team's membership/assignments,
 *  not team creation itself (matches the RLS: teams_admin_write is Admin-only). */
export async function createTeamAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can create a team." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A team name is required." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("teams").insert({ name });
  if (error) return { error: "Could not create the team. Check you have permission and try again." };

  revalidatePath(TEAMS_PATH);
  return { error: null };
}

/**
 * Shared authorization for every membership/assignment write below: an Admin (head of all teams),
 * or a lead of THAT SPECIFIC team — never a lead of a different team. Re-checked here even though
 * RLS (team_members_write / team_project_assignments_write) already enforces the same rule, so a
 * blocked attempt gets a clear message instead of a raw permission-denied error.
 */
async function requireTeamWriteAccess(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  teamId: string
): Promise<string | null> {
  const session = await requireSession();
  if (isAdminStaff(session)) return null;
  if (await isTeamLeadOf(supabase, session.userId, teamId)) return null;
  return "Only a JAGS Admin, or this team's own lead, can manage it.";
}

export async function addTeamMemberAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  const isTeamLead = formData.get("is_team_lead") === "on";
  if (!teamId || !userId) return { error: "Team and staff member are required." };

  const supabase = await createSupabaseServerClient();
  const authError = await requireTeamWriteAccess(supabase, teamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("team_members")
    .insert({ team_id: teamId, user_id: userId, is_team_lead: isTeamLead });

  if (error) {
    return {
      error: error.code === "23505" ? "That person is already on this team." : "Could not add the member.",
    };
  }

  revalidatePath(TEAMS_PATH);
  return { error: null };
}

export async function removeTeamMemberAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  if (!teamId || !userId) return { error: "Missing team or member." };

  const supabase = await createSupabaseServerClient();
  const authError = await requireTeamWriteAccess(supabase, teamId);
  if (authError) return { error: authError };

  const { error } = await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", userId);
  if (error) return { error: "Could not remove the member." };

  revalidatePath(TEAMS_PATH);
  return { error: null };
}

/** Promotes/demotes a member's is_team_lead flag on their own team. */
export async function setTeamLeadAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const userId = String(formData.get("user_id") ?? "").trim();
  const isTeamLead = formData.get("is_team_lead") === "on";
  if (!teamId || !userId) return { error: "Missing team or member." };

  const supabase = await createSupabaseServerClient();
  const authError = await requireTeamWriteAccess(supabase, teamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("team_members")
    .update({ is_team_lead: isTeamLead })
    .eq("team_id", teamId)
    .eq("user_id", userId);

  if (error) return { error: "Could not update the lead flag." };

  revalidatePath(TEAMS_PATH);
  return { error: null };
}

export async function assignTeamToProjectAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!teamId || !projectId) return { error: "Team and project are required." };

  const supabase = await createSupabaseServerClient();
  const authError = await requireTeamWriteAccess(supabase, teamId);
  if (authError) return { error: authError };

  const { error } = await supabase.from("team_project_assignments").insert({ team_id: teamId, project_id: projectId });
  if (error) {
    return {
      error: error.code === "23505" ? "This team is already assigned to that project." : "Could not assign the project.",
    };
  }

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      const session = await requireSession();
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "team_project_assignment",
        entityId: teamId,
        action: "assigned",
        actorId: session.userId,
        summary: "JAGS staff team assigned to project",
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(TEAMS_PATH);
  return { error: null };
}

export async function unassignTeamFromProjectAction(_prev: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const teamId = String(formData.get("team_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!teamId || !projectId) return { error: "Missing team or project." };

  const supabase = await createSupabaseServerClient();
  const authError = await requireTeamWriteAccess(supabase, teamId);
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("team_project_assignments")
    .delete()
    .eq("team_id", teamId)
    .eq("project_id", projectId);

  if (error) return { error: "Could not unassign the project." };

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      const session = await requireSession();
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "team_project_assignment",
        entityId: teamId,
        action: "unassigned",
        actorId: session.userId,
        summary: "JAGS staff team unassigned from project",
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(TEAMS_PATH);
  return { error: null };
}
