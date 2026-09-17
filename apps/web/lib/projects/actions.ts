"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

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

  if (!organizationId || !projectNumber || !name) {
    return { error: "Organisation, project number and name are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("projects").insert({
    organization_id: organizationId,
    project_number: projectNumber,
    name,
    site_location: siteLocation || null,
    created_by: user?.id ?? null,
  });

  if (error) {
    // A unique-constraint violation on (organization_id, project_number) is the one case worth a
    // specific message — everything else (including "not JAGS staff", caught by RLS) is a plain
    // permission/validation failure with no extra detail to leak.
    if (error.code === "23505") {
      return { error: "A project with that number already exists for this organisation." };
    }
    return { error: "Could not create the project. Check you have permission and try again." };
  }

  redirect("/inspect/projects");
}

export interface AddProjectPartyState {
  error: string | null;
}

const VALID_PARTY_TYPES = ["subcontractor", "main_contractor", "tpi_lab", "vendor", "client", "jags"] as const;
type PartyType = (typeof VALID_PARTY_TYPES)[number];

/**
 * Client onboarding gap this closes: previously project_parties could only be populated by hand-
 * written seed data — the project detail page displayed the party list but had no way to add to it,
 * so a brand-new project had no parties at all and its intervention grid (H/W/R/S sign-off chain)
 * had nothing to assign to. RLS (project_parties_staff_write) already allowed any JAGS staff to
 * insert here; this was purely a missing UI, same class of gap as organizations before
 * lib/organizations/actions.ts.
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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("project_parties").insert({
    project_id: projectId,
    party_type: partyType as PartyType,
    name,
    contact_name: contactName || null,
    contact_email: contactEmail || null,
    onboarded_by: onboardedBy,
  });

  if (error) {
    return { error: "Could not add the party. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
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

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export interface ProjectPartyActiveState {
  error: string | null;
}

/**
 * Single-party activate/deactivate. Admin-only. NOTE ON WHAT THIS ACTUALLY DOES: project_parties.is_active
 * is a display/record-keeping flag only — it is filtered on in the project detail page's party list
 * query (`.eq("is_active", true)`) but is NOT read by any RLS policy or by canSignOffForParty (see
 * lib/signoff/actions.ts, which gates purely on project_parties.user_id === session.userId) or by any
 * checklist-execution check. Flipping this does not, by itself, revoke a party's linked user's ability
 * to sign off or execute checklists on this project — that ability actually comes from access_grants
 * (platform-level reach) plus project_parties.user_id (which party a login represents). This action
 * still does something real and useful (it's the project's own record of who's currently engaged, and
 * every list/summary that filters on is_active reflects it), but it is not, today, an access-control
 * boundary. See deactivateAllProjectPartiesAction below for the bulk version this backs.
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
  const { error } = await supabase
    .from("project_parties")
    .update({ is_active: active })
    .eq("id", projectPartyId);

  if (error) return { error: "Could not update this party. Check you have permission and try again." };

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
 * Only touches project_parties.is_active — never access_grants, never deletes anything. Reversible
 * in one click (reactivateAllProjectPartiesAction) for exactly that reason: if the project reopens or
 * someone needs access again post-handover, nothing has to be recreated from scratch.
 *
 * See the note on setProjectPartyActive above: this is a project record-keeping switch, not (today) an
 * enforced access boundary — real access still runs through access_grants + project_parties.user_id.
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
  const { error } = await supabase
    .from("project_parties")
    .update({ is_active: false })
    .eq("project_id", projectId)
    .eq("is_active", true);

  if (error) return { error: "Could not deactivate project parties. Check you have permission and try again." };

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
  const { error } = await supabase
    .from("project_parties")
    .update({ is_active: true })
    .eq("project_id", projectId)
    .eq("is_active", false);

  if (error) return { error: "Could not reactivate project parties. Check you have permission and try again." };

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
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

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}
