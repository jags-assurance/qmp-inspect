"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";

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

  if (scopeType === "project") {
    const { data: projectRow } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .maybeSingle<{ organization_id: string }>();
    if (!projectRow || projectRow.organization_id !== organizationId) {
      return { error: "That project doesn't belong to the chosen organisation." };
    }
  }

  // Matches the DB's access_grants_scope_shape check constraint exactly, so a mismatched shape
  // fails with this clear message rather than a raw constraint-violation error.
  const { data: grant, error } = await supabase
    .from("access_grants")
    .insert({
      user_id: staffUserId,
      scope_type: scopeType as "global" | "organization" | "project",
      organization_id: scopeType === "global" ? null : organizationId,
      project_id: scopeType === "project" ? projectId : null,
      role,
    })
    .select("id")
    .single();

  if (error || !grant) {
    if (error?.code === "23505") {
      return { error: "This staff member already has a grant at that same scope." };
    }
    // Surfaces the access_grants_org_seat_limit trigger's own message (see
    // 20260917070000_org_plans_and_seat_limit.sql) rather than a generic failure, same pattern as
    // the background_jobs org rate-limit trigger in lib/reports/actions.ts.
    if (error?.message.includes("seat limit")) {
      return { error: error.message };
    }
    return { error: "Could not add the grant. Check you have permission and try again." };
  }

  // Found missing in a self-review audit: a 'global' grant has no organizationId to attach the
  // event to under the old NOT NULL schema, so it silently skipped auditing — the single most
  // sensitive grant type in this file (access to every organisation) was the one left unaudited.
  // organizationId omitted entirely (not just falsy) now genuinely means "platform-wide event," per
  // recordAuditEvent's own doc comment.
  await recordAuditEvent(supabase, {
    organizationId: organizationId || null,
    entityType: "staff_access_grant",
    entityId: grant.id,
    action: "granted",
    actorId: session.userId,
    summary: `Staff access (${scopeType}, role "${role}") granted to ${staffUserId}`,
    changes: { staff_user_id: staffUserId, scope_type: scopeType, project_id: projectId || null, role },
  });

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
  const { data: grant } = await supabase
    .from("access_grants")
    .select("user_id, organization_id, scope_type, role")
    .eq("id", grantId)
    .maybeSingle<{ user_id: string; organization_id: string | null; scope_type: string; role: string }>();

  // Never let an admin lock themselves (or the last global admin) out by removing a global grant.
  // Only global grants held by ACTIVE admin staff count: other global grants may all belong to
  // inspectors, who cannot manage access (the database enforces the same rule — 20261104000200).
  if (grant?.scope_type === "global") {
    const { data: otherGlobal } = await supabase
      .from("access_grants")
      .select("user_id, users(is_jags_staff, staff_role, is_active)")
      .eq("scope_type", "global")
      .neq("id", grantId)
      .returns<{ user_id: string; users: { is_jags_staff: boolean; staff_role: string | null; is_active: boolean } | null }[]>();
    const otherAdmins = (otherGlobal ?? []).filter(
      (g) => g.users?.is_jags_staff && g.users.is_active !== false && g.users.staff_role !== "inspector"
    );
    if (otherAdmins.length === 0) {
      return { error: "This is the only global grant held by an admin, so it can't be removed — nobody would be able to manage access." };
    }
    if (grant.user_id === session.userId) {
      return { error: "You can't remove your own global access. Ask another JAGS Admin to do it." };
    }
  }

  const { data: deletedGrants, error } = await supabase.from("access_grants").delete().eq("id", grantId).select("id");

  if (error || !deletedGrants?.length) {
    return { error: "Could not remove the grant. Check you have permission and try again." };
  }

  if (grant) {
    // Same platform-wide-event handling as addStaffGrantAction above — a 'global' grant's
    // organization_id is null, and that's now a real, auditable case rather than a skipped one.
    await recordAuditEvent(supabase, {
      organizationId: grant.organization_id,
      entityType: "staff_access_grant",
      entityId: grantId,
      action: "revoked",
      actorId: session.userId,
      summary: `Staff access (${grant.scope_type}, role "${grant.role}") revoked from ${grant.user_id}`,
    });
  }

  revalidatePath(STAFF_ACCESS_PATH);
  return { error: null };
}
