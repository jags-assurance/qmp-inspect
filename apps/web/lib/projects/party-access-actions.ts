"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { hasPermission } from "@/lib/rbac/permissions";
import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";

export interface PartyMemberActionState {
  error: string | null;
}

const INITIAL_STATE: PartyMemberActionState = { error: null };

interface PartyForAction {
  id: string;
  project_id: string;
  party_type: string;
  name: string;
  projects: { organization_id: string } | null;
}

/**
 * Same gate provisionPartyLoginAction (party-provisioning.ts) already uses for anything that can
 * hand out or change platform access on a party: a JAGS Admin, or someone holding the
 * provision_party_login custom permission on this specific project (the "Full Client-Managed" tier's
 * whole point). Kept as its own helper so every action below checks it identically.
 */
async function canManagePartyAccess(userId: string, projectId: string): Promise<boolean> {
  return await hasPermission(userId, "provision_party_login", projectId);
}

async function loadParty(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectPartyId: string
): Promise<PartyForAction | null> {
  const { data } = await supabase
    .from("project_parties")
    .select("id, project_id, party_type, name, projects(organization_id)")
    .eq("id", projectPartyId)
    .maybeSingle<PartyForAction>();
  return data ?? null;
}

/**
 * Switches a party between the two access modes the user asked for:
 *   - 'whole_org': every member added under this party is expected to get standard access — the
 *     default, matching how provisionPartyLoginAction's one-login-per-party already behaved.
 *   - 'selected_people': an admin must explicitly add each person; nobody else is implied to have
 *     access just because they're "from that party".
 * This column is advisory/workflow-facing only — see the migration's own comment
 * (20260930180000_project_party_members.sql): actual access is always a real access_grants row
 * either way, added/removed by addPartyMemberAction/removePartyMemberAction below, never implied
 * by this column alone. Nothing in has_org_access()/has_project_access() reads it.
 */
export async function setPartyAccessModeAction(
  _prev: PartyMemberActionState,
  formData: FormData
): Promise<PartyMemberActionState> {
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const accessMode = String(formData.get("access_mode") ?? "").trim();
  if (!projectPartyId) return { error: "Missing party." };
  if (accessMode !== "whole_org" && accessMode !== "selected_people") return { error: "Invalid access mode." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const party = await loadParty(supabase, projectPartyId);
  if (!party) return { error: "Party not found." };

  if (!isAdminStaff(session) && !(await canManagePartyAccess(session.userId, party.project_id))) {
    return { error: "Only a JAGS Admin (or someone granted provision_party_login) can change a party's access mode." };
  }

  const { error } = await supabase
    .from("project_parties")
    // access_mode isn't in the generated Database type yet — see the PROJECT_PARTY_MEMBERS_TABLE
    // comment above for why; same narrow escape hatch, scoped to just this one update payload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
    .update({ access_mode: accessMode } as any)
    .eq("id", projectPartyId);
  if (error) return { error: "Could not update the access mode." };

  revalidatePath(`/inspect/projects/${party.project_id}`);
  return { error: null };
}

/**
 * Adds one more person under a party — the real gap this whole feature closes: previously
 * provisionPartyLoginAction could only ever link ONE user_id per party, full stop. This is
 * deliberately scoped to EXISTING accounts only (looked up case-insensitively by email, same
 * pattern as provisionPartyLoginAction/addSelfManagedPartyAction) rather than duplicating that
 * action's Supabase Auth admin-createUser + temp-password + must_change_password + rollback
 * machinery a second time — creating brand-new login credentials is the single most sensitive
 * capability in this codebase, and it already has exactly one well-audited entry point. An admin
 * who needs to onboard someone with no account yet uses "Grant platform access" first (which sets
 * project_parties.user_id and creates the account if needed), then adds them here as an additional
 * member — or simply invites them by email here (invited_email, no user_id yet) as a placeholder
 * that shows up in the members list without granting anything until a real account exists.
 */
export async function addPartyMemberAction(
  _prev: PartyMemberActionState,
  formData: FormData
): Promise<PartyMemberActionState> {
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const emailInput = String(formData.get("email") ?? "").trim();
  const permissionMode = String(formData.get("permission_mode") ?? "standard").trim();
  const customRoleId = String(formData.get("custom_role_id") ?? "").trim() || null;

  if (!projectPartyId) return { error: "Missing party." };
  if (!emailInput) return { error: "Enter an email address." };
  if (permissionMode !== "standard" && permissionMode !== "custom") return { error: "Invalid permission mode." };
  if (permissionMode === "custom" && !customRoleId) return { error: "Choose a custom role." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const party = await loadParty(supabase, projectPartyId);
  if (!party) return { error: "Party not found." };
  if (!party.projects?.organization_id) return { error: "Could not resolve this party's organisation." };

  if (!isAdminStaff(session) && !(await canManagePartyAccess(session.userId, party.project_id))) {
    return { error: "Only a JAGS Admin (or someone granted provision_party_login) can add people to a party." };
  }

  // Same escaped-ILIKE, case-insensitive lookup provisionPartyLoginAction/addSelfManagedPartyAction
  // both already use.
  const escapedEmail = emailInput.replace(/[%_\\]/g, (match) => `\\${match}`);
  const { data: existingUser } = await supabase
    .from("users")
    .select("id, is_active")
    .ilike("email", escapedEmail)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (existingUser && !existingUser.is_active) {
    return { error: "An account exists for that email but has been deactivated." };
  }

  if (permissionMode === "custom" && customRoleId) {
    const { data: role } = await supabase
      .from("custom_roles")
      .select("id, organization_id")
      .eq("id", customRoleId)
      .maybeSingle<{ id: string; organization_id: string | null }>();
    if (!role) return { error: "That custom role no longer exists." };
    if (role.organization_id && role.organization_id !== party.projects.organization_id) {
      return { error: "That custom role belongs to a different organisation." };
    }
  }

  const userId = existingUser?.id ?? null;

  const { data: inserted, error: insertError } = await supabase
    .from(PROJECT_PARTY_MEMBERS_TABLE)
    .insert({
      project_party_id: projectPartyId,
      user_id: userId,
      invited_email: userId ? null : emailInput,
      permission_mode: permissionMode,
      custom_role_id: permissionMode === "custom" ? customRoleId : null,
      granted_by: session.userId,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (insertError) {
    return {
      error: insertError.code === "23505"
        ? "That person is already a member of this party."
        : "Could not add that person.",
    };
  }

  // No real account yet — recorded as an invited placeholder only; nothing to grant access to
  // until "Grant platform access" (provisionPartyLoginAction) creates one, at which point an admin
  // can come back and add them here properly (or reassign/relink separately).
  if (!userId) {
    revalidatePath(`/inspect/projects/${party.project_id}`);
    return { error: null };
  }

  // Standard access: the same access_grants row provisionPartyLoginAction already inserts for the
  // primary contact — role = party_type, project-scoped. Best-effort duplicate-ignore (23505), same
  // as every other access_grants insert in this codebase.
  const { error: grantError } = await supabase.from("access_grants").insert({
    user_id: userId,
    scope_type: "project",
    organization_id: party.projects.organization_id,
    project_id: party.project_id,
    role: party.party_type,
  });
  if (grantError && grantError.code !== "23505") {
    // Roll back the membership row so we don't leave a "member" who was never actually granted
    // anything — same compensating-rollback instinct as provisionPartyLoginAction's own comment.
    if (inserted) await supabase.from(PROJECT_PARTY_MEMBERS_TABLE).delete().eq("id", inserted.id);
    return {
      error: grantError.message.includes("seat limit")
        ? grantError.message
        : "Could not grant platform access to that person.",
    };
  }

  // Custom permission mode: assign the chosen custom role too (additive — hasPermission() is
  // always an extra allow-path on top of the baseline party_type access, never a replacement,
  // exactly as lib/rbac/permissions.ts's own doc comment says).
  if (permissionMode === "custom" && customRoleId) {
    const { error: assignError } = await supabase.from("custom_role_assignments").insert({
      role_id: customRoleId,
      user_id: userId,
      project_id: party.project_id,
    });
    if (assignError && assignError.code !== "23505") {
      return { error: "Access was granted, but assigning the custom role failed. Check with a JAGS Admin." };
    }
  }

  try {
    await recordAuditEvent(supabase, {
      organizationId: party.projects.organization_id,
      projectId: party.project_id,
      entityType: "project_party",
      entityId: projectPartyId,
      action: "member_added",
      actorId: session.userId,
      summary: `Added ${emailInput} to party "${party.name}" (${permissionMode === "custom" ? "custom permission" : "standard access"})`,
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${party.project_id}`);
  return { error: null };
}

/**
 * Removes a member and, if they held real access via this membership, revokes exactly the grant
 * this action itself created — never a broader "wipe every access_grants row for this user"
 * sweep, which could rip away access this SAME user separately and legitimately holds (e.g. as
 * this project's own responsible_person, or via a different party, or a JAGS staff org-wide grant).
 * Matched precisely by (user_id, scope_type='project', project_id, role=party_type) — the identical
 * shape addPartyMemberAction/provisionPartyLoginAction insert — so this can only ever remove a row
 * it (or the equally-shaped provisioning action) could plausibly have created for THIS party.
 */
export async function removePartyMemberAction(
  _prev: PartyMemberActionState,
  formData: FormData
): Promise<PartyMemberActionState> {
  const memberId = String(formData.get("member_id") ?? "").trim();
  if (!memberId) return { error: "Missing member." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: member } = await supabase
    .from(PROJECT_PARTY_MEMBERS_TABLE)
    .select("id, user_id, permission_mode, custom_role_id, project_parties(id, project_id, party_type, projects(organization_id))")
    .eq("id", memberId)
    .maybeSingle<{
      id: string;
      user_id: string | null;
      permission_mode: string;
      custom_role_id: string | null;
      project_parties: { id: string; project_id: string; party_type: string; projects: { organization_id: string } | null } | null;
    }>();
  if (!member || !member.project_parties) return { error: "Member not found." };

  const party = member.project_parties;

  if (!isAdminStaff(session) && !(await canManagePartyAccess(session.userId, party.project_id))) {
    return { error: "Only a JAGS Admin (or someone granted provision_party_login) can remove a party member." };
  }

  // Never let the primary contact (project_parties.user_id) be removed from here — that's a
  // reassignment/deactivation decision (ReassignPartyForm / ProjectPartyActiveToggle), a
  // deliberately separate, more consequential action with its own audit trail. This action only
  // ever touches ADDITIONAL members.
  const { data: primaryParty } = await supabase
    .from("project_parties")
    .select("user_id")
    .eq("id", party.id)
    .maybeSingle<{ user_id: string | null }>();
  if (member.user_id && primaryParty?.user_id === member.user_id) {
    return { error: "This is the party's primary contact — use Reassign or Deactivate instead." };
  }

  if (member.user_id) {
    if (member.permission_mode === "custom" && member.custom_role_id) {
      await supabase
        .from("custom_role_assignments")
        .delete()
        .eq("role_id", member.custom_role_id)
        .eq("user_id", member.user_id)
        .eq("project_id", party.project_id);
    }
    await supabase
      .from("access_grants")
      .delete()
      .eq("user_id", member.user_id)
      .eq("scope_type", "project")
      .eq("project_id", party.project_id)
      .eq("role", party.party_type);
  }

  const { error } = await supabase.from(PROJECT_PARTY_MEMBERS_TABLE).delete().eq("id", memberId);
  if (error) return { error: "Could not remove that member." };

  try {
    await recordAuditEvent(supabase, {
      organizationId: party.projects?.organization_id ?? null,
      projectId: party.project_id,
      entityType: "project_party",
      entityId: party.id,
      action: "member_removed",
      actorId: session.userId,
      summary: `Removed a member from party access`,
    });
  } catch {
    // Best-effort.
  }

  revalidatePath(`/inspect/projects/${party.project_id}`);
  return { error: null };
}
