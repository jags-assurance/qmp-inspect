"use server";

import { revalidatePath } from "next/cache";
import { getSelfManagedOrgIdsForUser } from "@/lib/rbac/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  isClientTeamLeadOf,
  grantClientTeamMemberProjectAccess,
  listClientTeamMemberIds,
  listClientTeamProjectIds,
} from "./helpers";

export interface ClientTeamActionState {
  error: string | null;
  /** Per-input problems (keys are form field names), shown beside the field. */
  fieldErrors?: Record<string, string>;
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
  if (!organizationId || !name) return { error: "Organisation and team name are required.", ...(!name ? { fieldErrors: { name: "Enter a team name." } } : {}) };

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
 * lib/projects/actions.ts), and grants them PROJECT-scoped access_grants rows for exactly the projects
 * this team is assigned to (B7) — never an organisation-wide grant, so a member reaches only the
 * assigned projects. A team with no assigned project yet gets membership only; the access arrives when
 * the team is assigned to a project (assignClientTeamToProjectAction grants every current member).
 * Duplicates are ignored. Existing org-wide grants of earlier members are left untouched (nothing is
 * deleted); see the client_team_org_wide_grants_review view for what an admin should review.
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

  const assignedProjectIds = await listClientTeamProjectIds(supabase, clientTeamId);
  const { error: grantError, granted } = await grantClientTeamMemberProjectAccess(supabase, {
    userId: targetUser.id,
    organizationId,
    projectIds: assignedProjectIds,
  });
  const grantWarning: string | null = null;
  if (grantError) {
    // A team member whose project access could not be set up is useless and confusing, so undo the
    // membership rather than leaving a half-added person behind (grants already inserted are kept: they
    // are scoped to this team's own projects and a retry is idempotent).
    await supabase
      .from("client_team_members")
      .delete()
      .eq("client_team_id", clientTeamId)
      .eq("user_id", targetUser.id);
    revalidatePath(CLIENT_TEAMS_PATH);
    return {
      error: grantError.message.includes("seat limit")
        ? `${grantError.message} The person was not added.`
        : "Could not grant this person access to the team's projects, so they were not added. Ask a JAGS Admin to add them.",
    };
  }

  // A real permission grant (project-scoped platform access), not just a team-membership add — logged
  // separately under its own entityType, one event per newly created grant.
  for (const projectId of granted) {
    try {
      await recordAuditEvent(supabase, {
        organizationId,
        projectId,
        entityType: "access_grant",
        entityId: targetUser.id,
        action: "granted",
        actorId: session.userId,
        summary: `Project access granted to ${email} via client team add`,
        changes: { user_id: targetUser.id, scope_type: "project", organization_id: organizationId, project_id: projectId, role: "member" },
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

  // B7: members only reach the projects their team is assigned to, so assigning a project is what
  // gives every current member project-scoped access to it (duplicates ignored; an existing org-wide
  // grant is untouched). A failure here does not undo the assignment; re-assigning is idempotent.
  let grantFailed = false;
  if (organizationId) {
    for (const memberId of await listClientTeamMemberIds(supabase, clientTeamId)) {
      const { error: grantError } = await grantClientTeamMemberProjectAccess(supabase, {
        userId: memberId,
        organizationId,
        projectIds: [projectId],
      });
      if (grantError) grantFailed = true;
    }
  }

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
  if (grantFailed) {
    return { error: "The team was assigned, but some members could not be given access to this project. Ask a JAGS Admin to grant them access." };
  }
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
