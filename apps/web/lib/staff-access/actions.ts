"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";

export interface StaffAccessState {
  error: string | null;
}

const STAFF_ACCESS_PATH = "/inspect/organisation/staff-access";

/**
 * Grants a JAGS staff member (admin or inspector) access to either every organisation ('global'),
 * one organisation, or one project — the same access_grants model already used for external
 * parties, just applied to staff too. A 'global' grant is what every staff account had by default
 * before this screen existed (and remains the default for a brand-new staff account); narrowing an
 * inspector to 'organization'/'project' is what actually restricts them, enforced by the RLS
 * policies added alongside this feature (has_org_access() is AND-ed with is_jags_staff() on every
 * tenant-scoped write, and alone on every tenant-scoped read).
 */
export async function addStaffGrantAction(
  _prev: StaffAccessState,
  formData: FormData
): Promise<StaffAccessState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can manage staff access." };
  }

  const staffUserId = String(formData.get("staff_user_id") ?? "").trim();
  const scopeType = String(formData.get("scope_type") ?? "").trim();
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!staffUserId || !role) {
    return { error: "Staff member and a role label are required." };
  }
  if (!["global", "organization", "project"].includes(scopeType)) {
    return { error: "Choose a valid scope." };
  }
  if (scopeType === "organization" && !organizationId) {
    return { error: "Choose an organisation for an organisation-scoped grant." };
  }
  if (scopeType === "project" && (!organizationId || !projectId)) {
    return { error: "Choose a project (and its organisation) for a project-scoped grant." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: staffUser } = await supabase
    .from("users")
    .select("id, is_jags_staff")
    .eq("id", staffUserId)
    .maybeSingle<{ id: string; is_jags_staff: boolean }>();

  if (!staffUser?.is_jags_staff) {
    return { error: "That user is not a JAGS staff account." };
  }

  // Matches the DB's access_grants_scope_shape check constraint exactly, so a mismatched shape
  // fails with this clear message rather than a raw constraint-violation error.
  const { error } = await supabase.from("access_grants").insert({
    user_id: staffUserId,
    scope_type: scopeType as "global" | "organization" | "project",
    organization_id: scopeType === "global" ? null : organizationId,
    project_id: scopeType === "project" ? projectId : null,
    role,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "This staff member already has a grant at that same scope." };
    }
    // Surfaces the access_grants_org_seat_limit trigger's own message (see
    // 20260917070000_org_plans_and_seat_limit.sql) rather than a generic failure, same pattern as
    // the background_jobs org rate-limit trigger in lib/reports/actions.ts.
    if (error.message.includes("seat limit")) {
      return { error: error.message };
    }
    return { error: "Could not add the grant. Check you have permission and try again." };
  }

  revalidatePath(STAFF_ACCESS_PATH);
  return { error: null };
}

export async function removeStaffGrantAction(
  _prev: StaffAccessState,
  formData: FormData
): Promise<StaffAccessState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can manage staff access." };
  }

  const grantId = String(formData.get("grant_id") ?? "").trim();
  if (!grantId) {
    return { error: "Missing grant." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("access_grants").delete().eq("id", grantId);

  if (error) {
    return { error: "Could not remove the grant. Check you have permission and try again." };
  }

  revalidatePath(STAFF_ACCESS_PATH);
  return { error: null };
}
