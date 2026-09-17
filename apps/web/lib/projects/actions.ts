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
