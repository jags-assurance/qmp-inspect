"use server";

import { revalidatePath } from "next/cache";
import { getSelfManagedOrgIdsForUser } from "@/lib/rbac/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { isClientTeamLeadOf } from "./helpers";

export interface ClientTeamActionState {
  error: string | null;
}

const CLIENT_TEAMS_PATH = "/inspect/organisation/client-teams";

async function findOrgForClientTeam(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  clientTeamId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("client_teams")
    .select("organization_id")
    .eq("id", clientTeamId)
    .maybeSingle<{ organization_id: string }>();
  return data?.organization_id ?? null;
}

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

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  if (!isAdminStaff(session)) {
    // Bootstrap case only: a member of a self-managed organisation (organisation-wide access).
    const ownOrgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!ownOrgIds.has(organizationId)) {
      return { error: "Only a JAGS Admin, or a member of a self-managed organisation creating its own first team, can create a client team." };
    }
  }
  const { data: team, error } = await supabase
    .from("client_teams")
    .insert({ organization_id: organizationId, name })
    .select("id")
    .single();

  if (error || !team) {
    return {
      error: "Could not create the team. Either you don't have permission, or this organisation already has a team (only a JAGS Admin or an existing team lead can add another).",
    };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "client_team",
    entityId: team.id,
    action: "created",
    actorId: session.userId,
    summary: `Client team "${name}" created`,
  });

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

  const organizationId = await findOrgForClientTeam(supabase, clientTeamId);
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      entityType: "client_team_member",
      entityId: clientTeamId,
      action: "added",
      actorId: session.userId,
      summary: `Member added to client team${isTeamLead ? " as lead" : ""}`,
      changes: { client_team_id: clientTeamId, user_id: userId, is_team_lead: isTeamLead },
    });
  }

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}

/**
 * Fallback for when the person isn't already in the "eligible members" dropdown (client-teams/
 * page.tsx's own eligibleUsers query, scoped to whoever already holds an org/project-scoped
 * access_grants row reaching this organisation) — the real gap this closes: a client team could
 * previously only ever add someone who ALREADY had platform access here, so a genuinely new
 * colleague at a self-managed client (a real JAGS Assurance login, but never yet put on a project)
 * had no way onto their own team at all.
 *
 * Looks the person up by email (same case-insensitive lookup addSelfManagedPartyAction uses in
 * lib/projects/actions.ts), and — best-effort, ignore-duplicate, same tolerance that action has —
 * grants them a baseline organisation-scoped access_grants row alongside adding them to the team,
 * so being on a client team actually means something (some real platform access into their own
 * org), not membership with nothing to show for it. A person who already holds broader access
 * (global/organisation/project) just gets a harmless redundant row if this one doesn't collide with
 * the existing unique-per-org partial index.
 */
export async function addClientTeamMemberByEmailAction(
  _prev: ClientTeamActionState,
  formData: FormData
): Promise<ClientTeamActionState> {
  const clientTeamId = String(formData.get("client_team_id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const isTeamLead = formData.get("is_team_lead") === "on";
  if (!clientTeamId || !email) return { error: "Team and email are required." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const authError = await requireClientTeamWriteAccess(supabase, session.userId, clientTeamId);
  if (authError) return { error: authError };

  const organizationId = await findOrgForClientTeam(supabase, clientTeamId);
  if (!organizationId) return { error: "Team not found." };

  // Escape ILIKE's own wildcard characters so a literal email is matched, not a pattern — mirrors
  // addSelfManagedPartyAction's identical lookup exactly.
  const escapedEmail = email.replace(/[%_\\]/g, (match) => `\\${match}`);
  const { data: targetUser } = await supabase
    .from("users")
    .select("id, is_active, is_jags_staff")
    .ilike("email", escapedEmail)
    .maybeSingle<{ id: string; is_active: boolean; is_jags_staff: boolean }>();

  if (!targetUser) {
    return { error: "No JAGS Assurance account exists for that email yet — that person needs an account created first." };
  }
  if (targetUser.is_jags_staff) {
    return { error: "That's a JAGS staff account — a client team only ever contains this organisation's own people." };
  }
  if (!targetUser.is_active) {
    return { error: "That account has been deactivated and can't be added." };
  }

  const { error: memberError } = await supabase
    .from("client_team_members")
    .insert({ client_team_id: clientTeamId, user_id: targetUser.id, is_team_lead: isTeamLead });
  if (memberError) {
    return {
      error: memberError.code === "23505" ? "That person is already on this team." : "Could not add the member.",
    };
  }

  const { error: grantError } = await supabase
    .from("access_grants")
    .insert({ user_id: targetUser.id, scope_type: "organization", organization_id: organizationId, role: "member" });
  let grantWarning: string | null = null;
  if (grantError && grantError.code !== "23505") {
    // A team member with no platform access is useless and confusing, so undo the membership
    // rather than leaving a half-added person behind.
    await supabase
      .from("client_team_members")
      .delete()
      .eq("client_team_id", clientTeamId)
      .eq("user_id", targetUser.id);
    revalidatePath(CLIENT_TEAMS_PATH);
    return {
      error: grantError.message.includes("seat limit")
        ? `${grantError.message} The person was not added.`
        : "Could not grant this person platform access, so they were not added. Ask a JAGS Admin to add them.",
    };
  }

  // Found missing in a self-review audit: this is a real permission grant (organisation-scoped
  // platform access), not just a team-membership add — the event below only covers the latter, so
  // logged separately here under its own entityType, whether or not the insert above actually
  // succeeded (a duplicate/23505 still means "this person already has this grant," worth a trail
  // entry distinct from a genuine seat-limit failure, which is only ever surfaced as grantWarning).
  if (!grantError || grantError.code === "23505") {
    try {
      await recordAuditEvent(supabase, {
        organizationId,
        entityType: "access_grant",
        entityId: targetUser.id,
        action: "granted",
        actorId: session.userId,
        summary: `Organisation access granted to ${email} via client team add`,
        changes: { user_id: targetUser.id, scope_type: "organization", organization_id: organizationId, role: "member" },
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "client_team_member",
    entityId: clientTeamId,
    action: "added_by_email",
    actorId: session.userId,
    summary: `Member added to client team by email (${email})${isTeamLead ? " as lead" : ""}`,
    changes: { client_team_id: clientTeamId, user_id: targetUser.id, is_team_lead: isTeamLead },
  });

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: grantWarning };
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

  const { data: removedRows, error } = await supabase
    .from("client_team_members")
    .delete()
    .eq("client_team_id", clientTeamId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !removedRows?.length) return { error: "Could not remove the member." };

  const organizationId = await findOrgForClientTeam(supabase, clientTeamId);
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      entityType: "client_team_member",
      entityId: clientTeamId,
      action: "removed",
      actorId: session.userId,
      summary: "Member removed from client team",
      changes: { client_team_id: clientTeamId, user_id: userId },
    });
  }

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

  const { data: updatedRows, error } = await supabase
    .from("client_team_members")
    .update({ is_team_lead: isTeamLead })
    .eq("client_team_id", clientTeamId)
    .eq("user_id", userId)
    .select("user_id");
  if (error || !updatedRows?.length) return { error: "Could not update the lead flag." };

  const organizationId = await findOrgForClientTeam(supabase, clientTeamId);
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      entityType: "client_team_member",
      entityId: clientTeamId,
      action: isTeamLead ? "promoted_to_lead" : "demoted_from_lead",
      actorId: session.userId,
      summary: `Member ${isTeamLead ? "promoted to" : "demoted from"} team lead`,
    });
  }

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

  const organizationId = await findOrgForClientTeam(supabase, clientTeamId);
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      projectId,
      entityType: "client_team_project_assignment",
      entityId: clientTeamId,
      action: "assigned",
      actorId: session.userId,
      summary: "Client team assigned to project",
    });
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

  const organizationId = await findOrgForClientTeam(supabase, clientTeamId);
  if (organizationId) {
    await recordAuditEvent(supabase, {
      organizationId,
      projectId,
      entityType: "client_team_project_assignment",
      entityId: clientTeamId,
      action: "unassigned",
      actorId: session.userId,
      summary: "Client team unassigned from project",
    });
  }

  revalidatePath(CLIENT_TEAMS_PATH);
  return { error: null };
}
