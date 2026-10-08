"use server";

import { seatLimitMessage } from "@/lib/plans/seat-limit";
import { parseSiteGeofenceForm } from "@/lib/checklists/geofence";
import { clientRecipientIds } from "@/lib/handover/helpers";
import { describeCloseBlockers, isClosedStatus, statusReasonError, type ProjectCloseCounts } from "@/lib/projects/close-helpers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { hasPermission } from "@/lib/rbac/permissions";
import { getSelfManagedOrgIdsForUser } from "@/lib/rbac/access";
import { recordAuditEvent } from "@/lib/audit/log";
import { checkPartyTypeLimit } from "./party-limits";
import { createNotification } from "@/lib/notifications/helpers";
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { logAiUsage } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { fetchProjectTimeZone, parseProjectTimeZone } from "@/lib/projects/timezone";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";

export interface CreateProjectState {
  error: string | null;
}

export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const projectNumber = String(formData.get("project_number") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const siteLocation = String(formData.get("site_location") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const contractNumber = String(formData.get("contract_number") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "").trim();
  const endDate = String(formData.get("end_date") ?? "").trim();
  const tz = parseProjectTimeZone(formData.get("timezone"));
  if (!tz.ok) return { error: tz.error };
  const locationNames = [
    ...new Set(
      String(formData.get("locations") ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    ),
  ].slice(0, 50);
  const responsiblePersonId = String(formData.get("responsible_person_id") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? "active").trim();
  const status = ["draft", "active", "on_hold"].includes(statusRaw) ? statusRaw : "active";
  if (startDate && endDate && endDate < startDate) {
    return { error: "The end date can't be before the start date." };
  }

  if (!organizationId || !projectNumber || !name) {
    return { error: "Organisation, project number and name are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const session = await requireSession();
  if (!isAdminStaff(session)) {
    const { data: org } = await supabase
      .from("organizations")
      .select("engagement_scope")
      .eq("id", organizationId)
      .maybeSingle<{ engagement_scope: string }>();
    if (org?.engagement_scope !== "self_managed" && org?.engagement_scope !== "client_managed") {
      return { error: "Only a JAGS Admin can create a project for this organisation." };
    }
  }

  const insertRow = {
    organization_id: organizationId,
    project_number: projectNumber,
    name,
    site_location: siteLocation || null,
    country: country || null,
    contract_number: contractNumber || null,
    start_date: startDate || null,
    end_date: endDate || null,
    status,
    responsible_person_id: isAdminStaff(session) && responsiblePersonId ? responsiblePersonId : null,
    created_by: user?.id ?? null,
  };
  const insertProject = (row: Record<string, unknown>) =>
    supabase.from("projects").insert(row as never).select("id").single<{ id: string }>();
  // A typed timezone is saved; blank keeps the column default (UTC). Before migration 20261104000500
  // the column is missing: retry without it rather than failing the whole create.
  let { data: project, error } = await insertProject(tz.value ? { ...insertRow, timezone: tz.value } : insertRow);
  if (tz.value && error && isMissingSchemaError(error)) ({ data: project, error } = await insertProject(insertRow));

  if (error || !project) {
    // A unique-constraint violation on (organization_id, project_number) is the one case worth a
    // specific message — everything else (including "not JAGS staff", caught by RLS) is a plain
    // permission/validation failure with no extra detail to leak.
    if (error?.code === "23505") {
      return { error: "A project with that number already exists for this organisation." };
    }
    return { error: "Could not create the project. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    projectId: project.id,
    entityType: "project",
    entityId: project.id,
    action: "created",
    actorId: user?.id ?? null,
    summary: `Project ${projectNumber} "${name}" created`,
  });

  // Optional starting locations for the inspection location dropdown (best-effort: the project
  // exists either way, and presets can be managed later on the project page).
  if (locationNames.length > 0) {
    await supabase
      .from("inspection_location_presets" as never)
      .insert(
        locationNames.map((name, index) => ({ organization_id: organizationId, project_id: project.id, name, sort_order: index })) as never
      );
  }

  redirect(`/inspect/projects/${project.id}`);
}

export interface AddProjectPartyState {
  error: string | null;
}

const VALID_PARTY_TYPES = ["subcontractor", "main_contractor", "tpi_lab", "vendor", "client", "jags"] as const;
type PartyType = (typeof VALID_PARTY_TYPES)[number];

/** Party types a non-JAGS actor may create: "jags" and "tpi_lab" carry staff-like rights in several
 *  policies (expected-record provider, register contributor), so only a JAGS Admin may mint them. */
const CLIENT_ADDABLE_PARTY_TYPES: readonly PartyType[] = ["subcontractor", "main_contractor", "vendor", "client"];

/** S1-13: refuses a new party when the project already has the maximum of ACTIVE parties of that type. */
async function partyLimitError(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  partyType: string
): Promise<string | null> {
  const { count, error } = await supabase
    .from("project_parties")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("party_type", partyType as PartyType)
    .eq("is_active", true);
  // A failed count must not block onboarding: the cap is a guard rail, not a security boundary.
  if (error || count === null) return null;
  const result = checkPartyTypeLimit(partyType, count);
  return result.ok ? null : result.message;
}

/**
 * Client onboarding gap this closes: previously project_parties could only be populated by hand-
 * written seed data — the project detail page displayed the party list but had no way to add to it,
 * so a brand-new project had no parties at all and its intervention grid (H/W/R/S sign-off chain)
 * had nothing to assign to. RLS (project_parties_staff_write) still allows any JAGS staff to insert
 * here, but that's broader than intended: adding/removing who's on a project is the same class of
 * sensitive capability as reassignSignoffPartyAction (lib/signoff/actions.ts), so this action itself
 * narrows it to a JAGS Admin, or the lead of a team assigned to this project, rather than "any
 * inspector with project access" — mirroring that action's own admin/team-lead check exactly.
 *
 * Deliberately does not set project_parties.user_id (the login-link column from
 * supabase/migrations/20260910070000_phase3_project_party_login_link.sql) — linking a party to a
 * real login account is a separate concern (that account has to exist first, via Supabase Auth) and
 * isn't required for JAGS staff to exercise the sign-off chain themselves, since staff can always
 * act on any party's behalf regardless of this link.
 */
const VALID_ONBOARDED_BY = ["jags", "client"] as const;
type OnboardedBy = (typeof VALID_ONBOARDED_BY)[number];

export async function addProjectPartyAction(
  _prev: AddProjectPartyState,
  formData: FormData
): Promise<AddProjectPartyState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const partyType = String(formData.get("party_type") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  const onboardedByRaw = String(formData.get("onboarded_by") ?? "jags").trim();
  const onboardedBy: OnboardedBy = VALID_ONBOARDED_BY.includes(onboardedByRaw as OnboardedBy)
    ? (onboardedByRaw as OnboardedBy)
    : "jags";

  if (!projectId || !partyType || !name) {
    return { error: "Party type and name are required." };
  }
  if (!VALID_PARTY_TYPES.includes(partyType as PartyType)) {
    return { error: "Invalid party type." };
  }

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Custom RBAC (CEO ask): a project-scoped or org-wide "add_project_party" grant is an additional
  // allow-path alongside Admin/team-lead — never a replacement for either (see lib/rbac/permissions.ts).
  // Lets an Admin hand this one specific capability to a staff member or a client's own user without
  // making them a team lead or promoting them to Admin.
  const allowed =
    isAdminStaff(session) ||
    (await isTeamLeadForProject(supabase, session.userId, projectId)) ||
    (await hasPermission(session.userId, "add_project_party", projectId));
  if (!allowed) {
    return { error: "Only a JAGS Admin, a lead of a team assigned to this project, or someone granted this permission, can add a project party." };
  }

  const { data: duplicate } = await supabase
    .from("project_parties")
    .select("id")
    .eq("project_id", projectId)
    .eq("party_type", partyType)
    .ilike("name", name.replace(/[%_\\]/g, (m) => `\\${m}`))
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (duplicate) {
    return { error: `A ${partyType.replace(/_/g, " ")} party named "${name}" is already on this project.` };
  }
  const limitError = await partyLimitError(supabase, projectId, partyType);
  if (limitError) return { error: limitError };

  const { data: party, error } = await supabase
    .from("project_parties")
    .insert({
      project_id: projectId,
      party_type: partyType as PartyType,
      name,
      contact_name: contactName || null,
      contact_email: contactEmail || null,
      onboarded_by: onboardedBy,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !party) {
    return { error: "Could not add the party. Check you have permission and try again." };
  }

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "project_party",
        entityId: party.id,
        action: "created",
        actorId: session.userId,
        summary: `Party "${name}" (${partyType}) added to project`,
      });

      // Tell the project's responsible person (unless they added it themselves).
      const { data: owner } = await supabase
        .from("projects")
        .select("responsible_person_id")
        .eq("id", projectId)
        .maybeSingle<{ responsible_person_id: string | null }>();
      if (owner?.responsible_person_id && owner.responsible_person_id !== session.userId) {
        await createNotification(supabase, {
          organizationId: project.organization_id,
          projectId,
          recipientUserId: owner.responsible_person_id,
          title: "A party was added to your project",
          body: `"${name}" (${partyType.replace(/_/g, " ")}) was added. They have no platform access until a login is granted.`,
          link: `/inspect/projects/${projectId}`,
        });
      }
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface AddSelfManagedPartyState {
  error: string | null;
}

/**
 * The self-managed-client-side counterpart to addProjectPartyAction above, for the gap closed by
 * supabase/migrations/20260919020000_self_managed_project_party_access.sql: a Self-Managed/
 * Platform-Only client (organizations.engagement_scope = 'self_managed') can create its own
 * projects (20260919010000_self_managed_project_creation.sql) but previously had no way to put
 * anyone on them — every project_party and access_grants row still required a JAGS Admin.
 *
 * Deliberately narrower than addProjectPartyAction in two ways:
 *   1. No "create a brand-new login" path. The target person must already have a real account
 *      (a row in public.users, which only exists once a real Supabase Auth user does) — looked up
 *      by email and confirmed BEFORE either insert is attempted, so a typo or a person who's never
 *      had an account fails with a clear, honest message rather than a raw FK-violation error from
 *      access_grants.user_id's not-null foreign key.
 *   2. It always creates both rows together: the project_parties row (workflow identity) AND a
 *      matching scope_type='project' access_grants row (actual platform access) — unlike
 *      addProjectPartyAction, which deliberately leaves user_id/access unset because JAGS staff
 *      don't need it (see that action's own comment). Here the whole point is giving someone real
 *      access, so skipping the grant would silently produce a party nobody can act as.
 *
 * Cross-organisation onboarding is intentionally allowed — see the migration's header comment for
 * the full reasoning (short version: the grant is pinned to this one project only, and JAGS staff
 * already onboard subcontractors/vendors from anywhere the same way).
 *
 * RLS (project_parties_self_managed_client_insert, access_grants_self_managed_project_insert) is
 * the real enforcement; this app-layer check exists only to give a clear error message instead of a
 * silent/opaque RLS rejection, same relationship every other action in this file has to its policy.
 */
export async function addSelfManagedPartyAction(
  _prev: AddSelfManagedPartyState,
  formData: FormData
): Promise<AddSelfManagedPartyState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const partyType = String(formData.get("party_type") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();

  if (!projectId || !partyType || !name || !email) {
    return { error: "Party type, organisation name and the person's email are all required." };
  }
  if (!VALID_PARTY_TYPES.includes(partyType as PartyType)) {
    return { error: "Invalid party type." };
  }

  const session = await requireSession();
  if (!isAdminStaff(session) && !CLIENT_ADDABLE_PARTY_TYPES.includes(partyType as PartyType)) {
    return { error: "You can add contractors, subcontractors, vendors and client parties. JAGS and TPI/lab parties are set up by a JAGS Admin." };
  }
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id, organizations(engagement_scope)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; organization_id: string; organizations: { engagement_scope: string } | null }>();

  if (!project) {
    return { error: "Project not found, or you don't have access to it." };
  }
  if (project.organizations?.engagement_scope !== "self_managed" && project.organizations?.engagement_scope !== "client_managed") {
    return { error: "This is only available on projects belonging to a self-managed or client-managed client organisation." };
  }
  // Only the organisation's own organisation-wide members may onboard parties — a project-scoped
  // (contractor / TPI) user must not be able to grant access.
  if (!isAdminStaff(session)) {
    const orgIds = await getSelfManagedOrgIdsForUser(supabase, session.userId);
    if (!orgIds.has(project.organization_id)) {
      return { error: "Only your organisation's own members can add parties to this project." };
    }
  }

  const limitError = await partyLimitError(supabase, projectId, partyType);
  if (limitError) return { error: limitError };

  // Escape ILIKE's own wildcard characters so a literal email is matched, not a pattern — email is
  // still compared case-insensitively since Supabase Auth normalises emails to lowercase on signup,
  // but this form shouldn't force whoever's typing to remember that.
  const escapedEmail = email.replace(/[%_\\]/g, (match) => `\\${match}`);
  const { data: targetUser } = await supabase
    .from("users")
    .select("id, is_active")
    .ilike("email", escapedEmail)
    .maybeSingle<{ id: string; is_active: boolean }>();

  if (!targetUser) {
    return { error: "No JAGS Assurance account exists for that email yet — that person needs an account created first." };
  }
  if (!targetUser.is_active) {
    return { error: "That account has been deactivated and can't be granted access." };
  }

  const { data: party, error: partyError } = await supabase
    .from("project_parties")
    .insert({
      project_id: projectId,
      party_type: partyType as PartyType,
      name,
      user_id: targetUser.id,
      onboarded_by: "client",
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (partyError || !party) {
    return { error: "Could not add the party. Check you have permission and try again." };
  }

  const { error: grantError } = await supabase.from("access_grants").insert({
    user_id: targetUser.id,
    scope_type: "project",
    organization_id: project.organization_id,
    project_id: projectId,
    role: partyType,
  });

  if (grantError) {
    // The project_parties row above already went in — a duplicate/seat-limit failure here still
    // leaves a real, visible party record (just without a login yet), rather than rolling back
    // silently, since neither Supabase client transaction spans both inserts.
    if (grantError.code === "23505") {
      return { error: "That person already has access to this project (the party was still added)." };
    }
    if (grantError.message.includes("seat limit")) {
      return { error: `${seatLimitMessage(grantError.message, false)} (The party was still added, without platform access.)` };
    }
    return { error: "The party was added, but granting platform access failed. Check with a JAGS Admin." };
  }

  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "project_party",
    entityId: party.id,
    action: "created_self_managed",
    actorId: session.userId,
    summary: `Party "${name}" (${partyType}) self-added and granted access to ${email}`,
  });

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

async function auditProjectSetting(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  actorId: string | null,
  settingKey: string,
  value: boolean
): Promise<void> {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    if (!project?.organization_id) return;
    await recordAuditEvent(supabase, {
      organizationId: project.organization_id,
      projectId,
      entityType: "project",
      entityId: projectId,
      action: "setting_updated",
      actorId,
      summary: `Project setting "${settingKey}" set to ${value}`,
      changes: { [settingKey]: value },
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }
}

export interface SetAllowClientExecutionState {
  error: string | null;
}

/**
 * Piece 4 of the teams/delegation work: per-project opt-in that widens checklist execution to also
 * allow a client-type party to execute (see lib/checklists/execution-parties.ts, read by both the
 * checklist page and lib/checklists/actions.ts). Admin-only, same boundary as project creation and
 * every other project-settings action.
 */
export async function setAllowClientExecutionAction(
  _prev: SetAllowClientExecutionState,
  formData: FormData
): Promise<SetAllowClientExecutionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this setting." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const allow = formData.get("allow_client_execution") === "on";
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({ allow_client_execution: allow })
    .eq("id", projectId);

  if (error) return { error: "Could not update this setting. Check you have permission and try again." };

  await auditProjectSetting(supabase, projectId, session.userId, "allow_client_execution", allow);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface SetEnforceHoldBlocksStartState {
  error: string | null;
}

/**
 * Per-project admin toggle for the R71 Hold-blocks-start behaviour (20260921000000_self_managed_
 * submit_and_checklist_gen.sql's sibling migration, 20260921010000_project_hold_blocks_start_
 * toggle.sql) — a real written requirement ("a hold point must wait"), but not every project's
 * process needs the software to enforce it at start time rather than just at completion, so this
 * is admin-configurable per project rather than a hardwired global rule. Defaults to true (the
 * stricter, compliant behaviour) — an admin who doesn't need it turns it off here, same
 * admin-only boundary as setAllowClientExecutionAction above.
 */
export async function setEnforceHoldBlocksStartAction(
  _prev: SetEnforceHoldBlocksStartState,
  formData: FormData
): Promise<SetEnforceHoldBlocksStartState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this setting." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const enforce = formData.get("enforce_hold_blocks_start") === "on";
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({ enforce_hold_blocks_start: enforce })
    .eq("id", projectId);

  if (error) return { error: "Could not update this setting. Check you have permission and try again." };

  await auditProjectSetting(supabase, projectId, session.userId, "enforce_hold_blocks_start", enforce);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface SetSiteGeofenceState {
  error: string | null;
  saved?: boolean;
}

/** S4-17: site point and radius for the soft start-inspection geofence. Admin only; blank clears. */
export async function setSiteGeofenceAction(_prev: SetSiteGeofenceState, formData: FormData): Promise<SetSiteGeofenceState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change this setting." };
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { error: "Missing project." };
  const parsed = parseSiteGeofenceForm(
    String(formData.get("site_latitude") ?? ""),
    String(formData.get("site_longitude") ?? ""),
    String(formData.get("site_radius_m") ?? "")
  );
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update(
      parsed.value
        ? { site_latitude: parsed.value.lat, site_longitude: parsed.value.lng, site_radius_m: parsed.value.radiusM }
        : { site_latitude: null, site_longitude: null, site_radius_m: null }
    )
    .eq("id", projectId);
  if (error) {
    const missing = error.code === "42703" || error.code === "PGRST204";
    return { error: missing ? "The site geofence needs a database update that has not been applied yet." : "Could not save the site location. Check you have permission and try again." };
  }
  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null, saved: true };
}

export interface SetAllowClientItpCreationState {
  error: string | null;
}

/**
 * Per-project opt-in that lets a client-type party create and build out an ITP from scratch on this
 * project — see supabase/migrations/20260918000000_client_itp_creation.sql (is_client_itp_creator())
 * for the actual RLS this flag drives, and lib/itps/actions.ts / the ITP detail page for the app-side
 * gating that mirrors it. A client can only ever populate a 'draft' ITP this way; submitting it into
 * the review pipeline stays a JAGS action regardless of who created it. Admin-only to change, same
 * boundary as setAllowClientExecutionAction above.
 */
export async function setAllowClientItpCreationAction(
  _prev: SetAllowClientItpCreationState,
  formData: FormData
): Promise<SetAllowClientItpCreationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this setting." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const allow = formData.get("allow_client_itp_creation") === "on";
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({ allow_client_itp_creation: allow })
    .eq("id", projectId);

  if (error) return { error: "Could not update this setting. Check you have permission and try again." };

  await auditProjectSetting(supabase, projectId, session.userId, "allow_client_itp_creation", allow);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface SetAllowContractorItpCreationState {
  error: string | null;
}

/**
 * Per-project opt-in that lets a subcontractor or main_contractor party create and build out an ITP
 * from scratch on this project — see supabase/migrations/20260919000000_contractor_itp_creation.sql
 * (is_client_itp_creator(), which despite its name now also covers this) for the actual RLS this
 * flag drives. Same shape and same boundaries as setAllowClientItpCreationAction above: draft-only,
 * Admin-only to change.
 */
export async function setAllowContractorItpCreationAction(
  _prev: SetAllowContractorItpCreationState,
  formData: FormData
): Promise<SetAllowContractorItpCreationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this setting." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const allow = formData.get("allow_contractor_itp_creation") === "on";
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({ allow_contractor_itp_creation: allow })
    .eq("id", projectId);

  if (error) return { error: "Could not update this setting. Check you have permission and try again." };

  await auditProjectSetting(supabase, projectId, session.userId, "allow_contractor_itp_creation", allow);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface SetAllowContractorStandaloneAssignmentState {
  error: string | null;
}

/**
 * Per-project opt-in that lets a subcontractor or main_contractor party run Standalone Assignments
 * (FAT/witness inspection/specific test/pre-shipment) on this project themselves — the tier-
 * independent counterpart to the client_managed-only run_standalone_assignment custom permission
 * (lib/rbac/types.ts): this flag works on ANY engagement tier (full_service/self_managed/
 * client_managed alike), same as allow_contractor_itp_creation above, since a subcontractor/
 * main_contractor actually running the equipment they supplied is real-world practice regardless of
 * how the client itself is engaged. See canRunStandaloneAssignment (lib/standalone/actions.ts) for
 * the actual gate this flag drives. Admin-only to change.
 */
export async function setAllowContractorStandaloneAssignmentAction(
  _prev: SetAllowContractorStandaloneAssignmentState,
  formData: FormData
): Promise<SetAllowContractorStandaloneAssignmentState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this setting." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const allow = formData.get("allow_contractor_standalone_assignment") === "on";
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({ allow_contractor_standalone_assignment: allow })
    .eq("id", projectId);

  if (error) return { error: "Could not update this setting. Check you have permission and try again." };

  await auditProjectSetting(supabase, projectId, session.userId, "allow_contractor_standalone_assignment", allow);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface ProjectPartyActiveState {
  error: string | null;
}

/**
 * Deletes this user's project-scoped access_grants row for this project — but ONLY if no other
 * active project_parties row for the same user+project still needs it (rare, but a single login can
 * in principle be linked to two parties on the same project). Safe to call unconditionally:
 * access_grants_one_per_project_per_user means there's at most one row to remove either way.
 */
async function revokeProjectAccessGrantIfUnused(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  userId: string
): Promise<void> {
  const { count } = await supabase
    .from("project_parties")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_active", true);

  if ((count ?? 0) > 0) return;

  await supabase.from("access_grants").delete().eq("project_id", projectId).eq("user_id", userId).eq("scope_type", "project");
}

/** Duplicate-tolerant re-insert of this party's project-scoped access grant, mirroring
 *  provisionPartyLoginAction's own insert shape. */
async function restoreProjectAccessGrant(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  organizationId: string,
  userId: string,
  role: string
): Promise<void> {
  const { error } = await supabase.from("access_grants").insert({
    user_id: userId,
    scope_type: "project",
    organization_id: organizationId,
    project_id: projectId,
    role,
  });
  if (error && error.code !== "23505") {
    console.error(`[projects] restoreProjectAccessGrant failed for user ${userId} on project ${projectId}:`, error);
  }
}

/**
 * Single-party activate/deactivate. Admin-only. project_parties.is_active is a real access boundary,
 * not just a display flag: canSignOffForParty (lib/signoff/actions.ts) and canExecuteItpItem
 * (lib/checklists/actions.ts) both require is_active alongside the user_id match, so flipping this
 * off already revoked that party's linked user's ability to sign off or execute checklists on this
 * project. It now ALSO revokes platform-level access (access_grants) on deactivation, and restores it
 * on reactivation — a deactivated party's login genuinely loses project access, not just those two
 * specific actions, matching what "Deactivate" implies in the UI. See deactivateAllProjectPartiesAction
 * below for the bulk version this backs.
 */
async function setProjectPartyActive(
  formData: FormData,
  active: boolean
): Promise<ProjectPartyActiveState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this." };
  }

  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectPartyId || !projectId) return { error: "Missing party or project." };

  const supabase = await createSupabaseServerClient();

  const { data: party } = await supabase
    .from("project_parties")
    .select("user_id, party_type")
    .eq("id", projectPartyId)
    .maybeSingle<{ user_id: string | null; party_type: string }>();

  const { error } = await supabase
    .from("project_parties")
    .update({ is_active: active })
    .eq("id", projectPartyId);

  if (error) return { error: "Could not update this party. Check you have permission and try again." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (party?.user_id) {
    if (active && project?.organization_id) {
      await restoreProjectAccessGrant(supabase, projectId, project.organization_id, party.user_id, party.party_type);
    } else if (!active) {
      await revokeProjectAccessGrantIfUnused(supabase, projectId, party.user_id);
    }
  }

  try {
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "project_party",
        entityId: projectPartyId,
        action: active ? "reactivated" : "deactivated",
        actorId: session.userId,
        summary: `Party ${active ? "reactivated" : "deactivated"}${party?.user_id ? " (platform access grant " + (active ? "restored" : "revoked") + ")" : ""}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export async function deactivateProjectPartyAction(
  _prev: ProjectPartyActiveState,
  formData: FormData
): Promise<ProjectPartyActiveState> {
  return setProjectPartyActive(formData, false);
}

export async function reactivateProjectPartyAction(
  _prev: ProjectPartyActiveState,
  formData: FormData
): Promise<ProjectPartyActiveState> {
  return setProjectPartyActive(formData, true);
}

export interface BulkProjectPartiesState {
  error: string | null;
}

/**
 * Bulk deactivate/reactivate every project_parties row for a project — the "project's done, no need
 * people" action from the CEO ask. Deliberately explicit and admin-only, never automatic on a status
 * change: a project's status can be flipped to 'completed'/'cancelled' by mistake or briefly, and
 * silently dropping everyone's party record on that alone would be exactly the surprising, hard-to-
 * notice failure mode the ask calls out. So this is its own button the admin clicks, with its own
 * confirm step in the UI (see DeactivateAllPartiesControl), not something wired to setProjectStatus.
 *
 * Also revokes each deactivated party's project-scoped access_grants row (per-user-facing decision:
 * "Deactivate" should mean the login actually loses project access, not just two specific in-app
 * actions — see setProjectPartyActive's own updated doc comment). Still fully reversible in one click
 * (reactivateAllProjectPartiesAction), which restores each grant rather than requiring a fresh invite.
 *
 * See the note on setProjectPartyActive above: is_active is a real access boundary now (canSignOffForParty
 * and canExecuteItpItem both require it), so this bulk action actually revokes every deactivated
 * party's ability to sign off or execute checklists on the project, not just hides them from lists.
 */
export async function deactivateAllProjectPartiesAction(
  _prev: BulkProjectPartiesState,
  formData: FormData
): Promise<BulkProjectPartiesState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can do this." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();

  // Every party being deactivated in this same bulk call — after the update below, none of them
  // remain active, so their access_grants rows can be removed unconditionally (no "still needed by
  // another active party" case to check, unlike the single-party path).
  const { data: parties } = await supabase
    .from("project_parties")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .not("user_id", "is", null)
    .returns<{ user_id: string | null }[]>();

  const { error } = await supabase
    .from("project_parties")
    .update({ is_active: false })
    .eq("project_id", projectId)
    .eq("is_active", true);

  if (error) return { error: "Could not deactivate project parties. Check you have permission and try again." };

  const userIds = [...new Set((parties ?? []).map((p) => p.user_id).filter((id): id is string => Boolean(id)))];
  if (userIds.length > 0) {
    // JAGS staff who happen to be linked to a party keep their own project grants (they work on the
    // project in their own right, not through the party).
    const { data: staffRows } = await supabase.from("users").select("id").in("id", userIds).eq("is_jags_staff", true).returns<{ id: string }[]>();
    const staffIds = new Set((staffRows ?? []).map((r) => r.id));
    const revokeIds = userIds.filter((id) => !staffIds.has(id));
    if (revokeIds.length > 0) {
      await supabase.from("access_grants").delete().eq("project_id", projectId).eq("scope_type", "project").in("user_id", revokeIds);
    }
  }

  await auditProjectSetting(supabase, projectId, session.userId, "all_parties_deactivated", true);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export async function reactivateAllProjectPartiesAction(
  _prev: BulkProjectPartiesState,
  formData: FormData
): Promise<BulkProjectPartiesState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can do this." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();

  const [{ data: parties }, { data: project }] = await Promise.all([
    supabase
      .from("project_parties")
      .select("user_id, party_type")
      .eq("project_id", projectId)
      .eq("is_active", false)
      .not("user_id", "is", null)
      .returns<{ user_id: string | null; party_type: string }[]>(),
    supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>(),
  ]);

  const { error } = await supabase
    .from("project_parties")
    .update({ is_active: true })
    .eq("project_id", projectId)
    .eq("is_active", false);

  if (error) return { error: "Could not reactivate project parties. Check you have permission and try again." };

  if (project?.organization_id) {
    for (const party of parties ?? []) {
      if (!party.user_id) continue;
      await restoreProjectAccessGrant(supabase, projectId, project.organization_id, party.user_id, party.party_type);
    }
  }

  await auditProjectSetting(supabase, projectId, session.userId, "all_parties_deactivated", false);

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface UpdateProjectStatusState {
  error: string | null;
}

const VALID_PROJECT_STATUSES = ["draft", "active", "on_hold", "completed", "cancelled"] as const;
type ProjectStatus = (typeof VALID_PROJECT_STATUSES)[number];

/**
 * Closes a real gap: projects.status (supabase/migrations/20260909220000_phase1_projects.sql) has
 * carried 'completed'/'cancelled' in its check constraint since Phase 1, and other code already
 * talks about a project being "flipped to completed" (see deactivateAllProjectPartiesAction's own
 * comment above), but nothing ever actually wrote to this column — every project sat at its default
 * 'active' forever. Admin-only, same boundary as the bulk deactivate/reactivate actions this sits
 * next to; deliberately NOT wired to deactivateAllProjectPartiesAction (that stays its own explicit,
 * confirmed click — see that action's own comment for why "status change auto-triggers party
 * deactivation" is exactly the surprising behaviour to avoid).
 */
export async function updateProjectStatusAction(
  _prev: UpdateProjectStatusState,
  formData: FormData
): Promise<UpdateProjectStatusState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change a project's status." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ProjectStatus;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!projectId || !VALID_PROJECT_STATUSES.includes(status)) {
    return { error: "Missing project or invalid status." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase
    .from("projects")
    .select("organization_id, status, responsible_person_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string; status: string; responsible_person_id: string | null }>();
  if (!current) return { error: "Project not found, or you do not have access to it." };
  if (current.status === status) return { error: null };

  const reasonError = statusReasonError(current.status, status, reason);
  if (reasonError) return { error: reasonError };

  if (status === "completed") {
    // close_project() is admin-only in SQL and refuses to close with open NCRs / punch items / draft
    // inspections unless a reason is given (the RPC then records the reason in the audit log).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
    const { error: rpcError } = await (supabase.rpc as any)("close_project", {
      p_project_id: projectId,
      p_reason: reason || null,
    });
    if (rpcError) {
      const m = (rpcError.message ?? "").toLowerCase();
      if (m.includes("open") || m.includes("draft") || m.includes("reason")) {
        return { error: "This project still has open NCRs, punch items or draft inspections. Enter a reason to close it anyway." };
      }
      return { error: "Could not close the project. Check you have permission and try again." };
    }
  } else {
    const { data: updated, error } = await supabase
      .from("projects")
      .update({ status })
      .eq("id", projectId)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error || !updated) {
      return { error: "Could not update the project's status. Check you have permission and try again." };
    }
  }

  await recordAuditEvent(supabase, {
    organizationId: current.organization_id,
    projectId,
    entityType: "project",
    entityId: projectId,
    action: isClosedStatus(current.status) ? "reopened" : "status_changed",
    actorId: session.userId,
    summary: `Project status changed from "${current.status}" to "${status}"${reason ? ` (${reason})` : ""}`,
    changes: { from: current.status, to: status, reason: reason || null },
  });

  // Re-opening after a handover was issued: the issued certificate is not touched (it stays as certified)
  // but the audit trail records that the project moved on afterwards.
  if (isClosedStatus(current.status) && status !== "completed") {
    try {
      const { data: issuedBooks } = await supabase
        .from("data_books" as never)
        .select("id, book_number")
        .eq("project_id" as never, projectId as never)
        .eq("status" as never, "issued" as never)
        .returns<{ id: string; book_number: string }[]>();
      if (issuedBooks && issuedBooks.length > 0) {
        await recordAuditEvent(supabase, {
          organizationId: current.organization_id,
          projectId,
          entityType: "project",
          entityId: projectId,
          action: "reopened_after_handover",
          actorId: session.userId,
          summary: `Project re-opened after Data Book ${issuedBooks.map((b) => b.book_number).join(", ")} was issued - start a new revision when the work is finished`,
        });
      }
    } catch {
      // Best-effort.
    }
  }

  // Re-opening a closed project: tell the client users on the project and its responsible person.
  if (isClosedStatus(current.status)) {
    try {
      const { data: grants } = await supabase
        .from("access_grants")
        .select("user_id, role, scope_type, organization_id, project_id")
        .eq("role", "client")
        .or(`organization_id.eq.${current.organization_id},project_id.eq.${projectId}`)
        .returns<{ user_id: string; role: string; scope_type: string; organization_id: string | null; project_id: string | null }[]>();
      const recipients = new Set(clientRecipientIds(grants ?? [], { id: projectId, organizationId: current.organization_id }, [session.userId]));
      if (current.responsible_person_id && current.responsible_person_id !== session.userId) recipients.add(current.responsible_person_id);
      if (recipients.size > 0) {
        await supabase.from("notifications").insert(
          [...recipients].map((id) => ({
            organization_id: current.organization_id,
            project_id: projectId,
            recipient_user_id: id,
            title: "Project re-opened",
            body: `The project was moved from ${current.status} to ${status}. Reason: ${reason}`,
            link: `/inspect/projects/${projectId}`,
          }))
        );
      }
    } catch {
      // Best-effort.
    }
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  revalidatePath("/inspect/projects");
  return { error: null };
}

export interface ProjectCloseSummary extends ProjectCloseCounts {
  blockers: string[];
}

/** Counts shown in the confirm dialog before completing / cancelling a project. Admin-only. */
export async function getProjectCloseSummaryAction(projectId: string): Promise<ProjectCloseSummary | null> {
  const session = await requireSession();
  if (!isAdminStaff(session) || !projectId) return null;
  const supabase = await createSupabaseServerClient();
  const [ncr, punch, drafts, project, books, revisions] = await Promise.all([
    // Mirrors projects_status_guard (20261104000600): a null severity counts, only observations don't.
    supabase
      .from("ncrs" as never)
      .select("id", { count: "exact", head: true })
      .eq("project_id" as never, projectId as never)
      .neq("status" as never, "closed" as never)
      .or("severity.is.null,severity.neq.observation" as never),
    supabase.from("punch_list_items").select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "closed"),
    supabase.from("inspection_records").select("id", { count: "exact", head: true }).eq("project_id", projectId).is("overall_result", null),
    supabase.from("projects").select("project_number, name").eq("id", projectId).maybeSingle<{ project_number: string; name: string }>(),
    supabase.from("data_books").select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "issued"),
    supabase.from("itps").select("id", { count: "exact", head: true }).eq("project_id", projectId).eq("revision_needs_approval", true),
  ]);
  let overdueHolds = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (supabase.rpc as any)("overdue_hold_points");
    const label = project.data ? `${project.data.project_number} — ${project.data.name}` : null;
    overdueHolds = ((rows ?? []) as { project_label: string }[]).filter((r) => r.project_label === label).length;
  } catch {
    // Count shows 0 if the RPC is unavailable.
  }
  const counts: ProjectCloseCounts = {
    openNcrs: ncr.count ?? 0,
    openPunch: punch.count ?? 0,
    overdueHolds,
    draftInspections: drafts.count ?? 0,
    unissuedDataBooks: books.count ?? 0,
    pendingItpRevisions: revisions.count ?? 0,
  };
  return { ...counts, blockers: describeCloseBlockers(counts) };
}

export interface SetResponsiblePersonState {
  error: string | null;
}

/**
 * The project's named point of accountability (projects.responsible_person_id), distinct from the
 * per-activity H/W/R/S party assignments — this is "who do I go to for this project overall", picked
 * from anyone whose access_grants already reach this project's organisation/project, same eligible-
 * user set the reassign-party-form.tsx flow already uses (see the eligibleUsers query in
 * app/inspect/projects/[projectId]/page.tsx). Admin-only to change; visible to everyone with access
 * to the project (the page itself decides display, not this action).
 */
export async function setResponsiblePersonAction(
  _prev: SetResponsiblePersonState,
  formData: FormData
): Promise<SetResponsiblePersonState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change this." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const responsiblePersonId = String(formData.get("responsible_person_id") ?? "").trim();
  if (!projectId) return { error: "Missing project." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("projects")
    .update({ responsible_person_id: responsiblePersonId || null })
    .eq("id", projectId);

  if (error) return { error: "Could not update the responsible person. Check you have permission and try again." };

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "project",
        entityId: projectId,
        action: "responsible_person_updated",
        actorId: session.userId,
        summary: "Responsible person updated",
        changes: { responsible_person_id: responsiblePersonId || null },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface AskProjectQuestionState {
  error: string | null;
  answer: string | null;
  question: string | null;
}

const EMPTY_ASK_STATE: AskProjectQuestionState = { error: null, answer: null, question: null };

// Caps how much of each list feeds the context block, so one very large/old project can't blow the
// prompt budget — same reasoning as MAX_COMBINED_SOURCE_CHARS in gemini-provider.ts, just simpler
// since this context is short structured lines, not full document text.
const QA_CONTEXT_ITP_LIMIT = 40;
const QA_CONTEXT_NCR_LIMIT = 20;
const QA_CONTEXT_RECORD_LIMIT = 15;

/**
 * R111: "Ask your project" — a project-scoped Q&A assistant. Assembles a plain-text context block
 * from this project's OWN real data (ITP titles/statuses, open NCRs, recent inspection records) —
 * never any other project's — and passes it to the AI provider together with the question. No
 * fabricated grounding: if this context genuinely doesn't contain an answer, the model saying so is
 * the correct, honest outcome, not something this action tries to prevent. Nothing here writes
 * anything; it only returns text for display in the chat box.
 */
export async function askProjectQuestionAction(
  _prev: AskProjectQuestionState,
  formData: FormData
): Promise<AskProjectQuestionState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();

  if (!projectId || !question) {
    return { ...EMPTY_ASK_STATE, error: "Type a question first." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("name, project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ name: string; project_number: string; organization_id: string }>();

  if (!project) return { ...EMPTY_ASK_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_ASK_STATE, error: gate.reason };

  const [{ data: itps }, { data: openNcrs }, { data: records }] = await Promise.all([
    supabase
      .from("itps")
      .select("itp_number, title, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(QA_CONTEXT_ITP_LIMIT)
      .returns<{ itp_number: string; title: string; status: string }[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("ncr_number, severity, status, description")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(QA_CONTEXT_NCR_LIMIT)
      .returns<{ ncr_number: string; severity: string; status: string; description: string }[]>(),
    supabase
      .from("inspection_records")
      .select("activity, overall_result, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(QA_CONTEXT_RECORD_LIMIT)
      .returns<{ activity: string; overall_result: string | null; created_at: string }[]>(),
  ]);

  const itpLines =
    (itps ?? []).length > 0
      ? (itps ?? []).map((i) => `- ITP ${i.itp_number}: "${i.title}" — status: ${i.status}`).join("\n")
      : "(no ITPs recorded on this project yet)";

  const ncrLines =
    (openNcrs ?? []).length > 0
      ? (openNcrs ?? [])
          .map((n) => `- NCR ${n.ncr_number} (${n.severity}, ${n.status}): ${n.description.slice(0, 200)}`)
          .join("\n")
      : "(no open NCRs on this project)";

  const recordLines =
    (records ?? []).length > 0
      ? (records ?? [])
          .map((r) => `- ${new Date(r.created_at).toLocaleDateString("en-GB")}: "${r.activity}" — result: ${r.overall_result ?? "pending"}`)
          .join("\n")
      : "(no inspection records yet)";

  const projectContext = [
    `Project: ${project.project_number} — ${project.name}`,
    "",
    "ITPs (most recent first):",
    itpLines,
    "",
    "Open NCRs (most recent first):",
    ncrLines,
    "",
    "Recent inspection records (most recent first):",
    recordLines,
  ].join("\n");

  try {
    // Hashing question + the assembled context together (not the question alone) means a cache hit
    // only ever happens when the underlying project data hasn't changed since the last time this
    // exact question was asked — new ITPs/NCRs/inspection activity naturally produce a different
    // context and so a fresh call, which is exactly the safety property this feature needs (a
    // stale cached answer here would be actively wrong, not just less fresh).
    const inputHash = hashAiCacheInput({ question, projectContext });
    const cached = await findCachedAiResponse<string>(supabase, {
      organizationId: project.organization_id,
      feature: "project_qa",
      promptVersion: PROMPT_VERSIONS.project_qa,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let answer: string;
    if (cached) {
      answer = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.askProjectQuestion({ question, projectContext }));
      answer = captured.result;
      usage = captured.usage;
    }
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId,
      userId: user?.id ?? null,
      feature: "project_qa",
      modelId: getGeminiModel("project_qa"),
      promptVersion: PROMPT_VERSIONS.project_qa,
      sourceRef: { projectId, question },
      aiResponse: answer,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, answer, question };
  } catch (err) {
    return { ...EMPTY_ASK_STATE, error: aiErrorMessage(err, "Could not get an answer right now.") };
  }
}

export interface UpdateProjectDetailsState {
  error: string | null;
  saved?: boolean;
}

/**
 * Edit a project's descriptive details (name, number, site, country, contract number, dates).
 * Allowed for a JAGS Admin or an org-wide self-managed/client-managed member of the owning
 * organisation; the projects update RLS policy remains the real enforcement (zero rows updated
 * is reported as a permission error rather than a silent success).
 */
export async function updateProjectDetailsAction(
  _prev: UpdateProjectDetailsState,
  formData: FormData
): Promise<UpdateProjectDetailsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const projectNumber = String(formData.get("project_number") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const siteLocation = String(formData.get("site_location") ?? "").trim();
  const country = String(formData.get("country") ?? "").trim();
  const contractNumber = String(formData.get("contract_number") ?? "").trim();
  const startDate = String(formData.get("start_date") ?? "").trim();
  const endDate = String(formData.get("end_date") ?? "").trim();
  const tz = parseProjectTimeZone(formData.get("timezone"));
  if (!tz.ok) return { error: tz.error };

  if (!projectId) return { error: "Missing project." };
  if (!projectNumber || !name) return { error: "Project number and name are required." };
  if (projectNumber.length > 60 || name.length > 200) return { error: "Project number or name is too long." };
  if (startDate && endDate && endDate < startDate) return { error: "The end date can't be before the start date." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("projects")
    .select("organization_id, project_number, name, site_location, country, contract_number, start_date, end_date")
    .eq("id", projectId)
    .maybeSingle<{
      organization_id: string;
      project_number: string;
      name: string;
      site_location: string | null;
      country: string | null;
      contract_number: string | null;
      start_date: string | null;
      end_date: string | null;
    }>();
  if (!existing) return { error: "Project not found." };

  const allowed =
    isAdminStaff(session) ||
    (!session.isJagsStaff && (await getSelfManagedOrgIdsForUser(supabase, session.userId)).has(existing.organization_id));
  if (!allowed) return { error: "Only a JAGS Admin or your organisation's self-managed users can edit project details." };

  const next = {
    project_number: projectNumber,
    name,
    site_location: siteLocation || null,
    country: country || null,
    contract_number: contractNumber || null,
    start_date: startDate || null,
    end_date: endDate || null,
  };
  // timezone is saved only when one was typed (a blank field leaves the current zone alone), and the
  // write is retried without it while migration 20261104000500 is not applied.
  const previousTz = tz.value ? await fetchProjectTimeZone(supabase, projectId) : null;
  const withTz = tz.value ? { ...next, timezone: tz.value } : next;
  let { data: updated, error } = await supabase.from("projects").update(withTz as never).eq("id", projectId).select("id");
  if (tz.value && error && isMissingSchemaError(error)) {
    ({ data: updated, error } = await supabase.from("projects").update(next).eq("id", projectId).select("id"));
  }
  if (error?.code === "23505") return { error: "A project with that number already exists for this organisation." };
  if (error || !updated || updated.length === 0) {
    return { error: "Could not save the changes. Check you have permission and try again." };
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (existing[key] !== next[key]) changes[key] = { from: existing[key], to: next[key] };
  }
  if (tz.value && previousTz !== tz.value) changes.timezone = { from: previousTz, to: tz.value };
  if (Object.keys(changes).length > 0) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: existing.organization_id,
        projectId,
        entityType: "project",
        entityId: projectId,
        action: "details_updated",
        actorId: session.userId,
        summary: `Project details updated (${Object.keys(changes).join(", ")})`,
        changes,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  revalidatePath("/inspect/projects");
  return { error: null, saved: true };
}
