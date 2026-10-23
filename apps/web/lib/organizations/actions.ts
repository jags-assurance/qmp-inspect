"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { validateDeactivationReason, validateOrganizationName } from "@/lib/organizations/lifecycle";

export interface CreateOrganizationState {
  error: string | null;
  /** Per-input problems (keys are form field names), shown beside the field. */
  fieldErrors?: Record<string, string>;
  /** Name of the organisation that was just created — drives the success message. */
  created?: string | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Client onboarding: creates a new tenant (organizations row). This was previously only possible by
 * hand-writing into the database (the seed data's three demo organisations) — there was no in-app
 * way to onboard a real new client at all. Admin-only, same boundary as project creation, numbering
 * settings and staff access (organizations_staff_insert in
 * supabase/migrations/20260910100000_phase3_fix_organizations_write_select_leak.sql enforces this at
 * the RLS layer too, so this check is a clean error message, not the only guard).
 *
 * Nothing else is created alongside the organization here (no default project, no numbering config
 * row, no access grant) — those already have their own dedicated flows (New project, Numbering
 * settings' org picker, Staff Access) that work against any existing organization, this one included,
 * the moment it exists.
 */
export async function createOrganizationAction(
  _prev: CreateOrganizationState,
  formData: FormData
): Promise<CreateOrganizationState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can create a new client organisation." };

  const name = String(formData.get("name") ?? "").trim();
  const slugOverride = String(formData.get("slug") ?? "").trim();
  const engagementMode = String(formData.get("engagement_mode") ?? "jags_led").trim();
  const engagementScope = String(formData.get("engagement_scope") ?? "full_service").trim();

  if (!name) return { error: "Organisation name is required.", fieldErrors: { name: "Enter the organisation name." } };
  if (!["jags_led", "co_branded", "white_label"].includes(engagementMode)) {
    return { error: "Invalid engagement mode.", fieldErrors: { engagement_mode: "Choose an engagement mode." } };
  }
  if (!["full_service", "self_managed", "client_managed"].includes(engagementScope)) {
    return { error: "Invalid engagement scope.", fieldErrors: { engagement_scope: "Choose an engagement scope." } };
  }

  const slug = slugify(slugOverride || name);
  if (!slug) {
    const msg = "Could not derive a URL-safe slug from that name — try a different name or set one explicitly.";
    return { error: msg, fieldErrors: { [slugOverride ? "slug" : "name"]: msg } };
  }

  const supabase = await createSupabaseServerClient();
  const { data: organization, error } = await supabase
    .from("organizations")
    .insert({
      name,
      slug,
      engagement_mode: engagementMode as "jags_led" | "co_branded" | "white_label",
      engagement_scope: engagementScope as "full_service" | "self_managed" | "client_managed",
    })
    .select("id")
    .single();

  if (error || !organization) {
    if (error?.code === "23505") {
      const msg = `An organisation with the slug "${slug}" already exists — choose a different name or set a custom slug.`;
      return { error: msg, fieldErrors: { [slugOverride ? "slug" : "name"]: msg } };
    }
    return { error: "Could not create the organisation. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId: organization.id,
    entityType: "organization",
    entityId: organization.id,
    action: "created",
    actorId: session.userId,
    summary: `Organisation "${name}" created`,
  });

  revalidatePath("/inspect/organisation/clients");
  revalidatePath("/inspect/projects/new");
  revalidatePath("/inspect/organisation/numbering");
  revalidatePath("/inspect/organisation/staff-access");
  revalidatePath("/inspect/settings");
  return { error: null, created: name };
}

export interface OrganizationLifecycleState {
  error: string | null;
  message: string | null;
}

/** Admin-only rename. Name only; the slug never changes. RLS + organizations_column_guard also enforce admin-only. */
export async function renameOrganizationAction(
  _prev: OrganizationLifecycleState,
  formData: FormData
): Promise<OrganizationLifecycleState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can rename an organisation.", message: null };
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) return { error: "Missing organisation.", message: null };
  const { name, error: nameError } = validateOrganizationName(String(formData.get("name") ?? ""));
  if (nameError) return { error: nameError, message: null };

  const supabase = await createSupabaseServerClient();
  const { data: before } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle<{ name: string }>();
  if (!before) return { error: "Organisation not found.", message: null };
  if (before.name === name) return { error: "That is already the organisation's name.", message: null };

  const { data: updated, error } = await supabase.from("organizations").update({ name }).eq("id", organizationId).select("id");
  if (error || !updated?.length) return { error: "Could not rename the organisation. Refresh and try again.", message: null };

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "renamed",
    actorId: session.userId,
    summary: `Organisation renamed from "${before.name}" to "${name}"`,
    changes: { name: { from: before.name, to: name } },
  });
  revalidateOrgPaths();
  return { error: null, message: `Renamed to ${name}.` };
}

/**
 * Admin-only deactivate (reason required) / reactivate. Nothing is deleted: the database makes every
 * project of an inactive organisation read-only (project_is_writable) and blocks new projects.
 */
export async function setOrganizationActiveAction(
  _prev: OrganizationLifecycleState,
  formData: FormData
): Promise<OrganizationLifecycleState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can deactivate or reactivate an organisation.", message: null };
  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const activate = String(formData.get("activate") ?? "") === "true";
  if (!organizationId) return { error: "Missing organisation.", message: null };

  let reason: string | null = null;
  if (!activate) {
    const v = validateDeactivationReason(String(formData.get("reason") ?? ""));
    if (v.error) return { error: v.error, message: null };
    reason = v.reason;
  }

  const supabase = await createSupabaseServerClient();
  const { data: org } = await supabase.from("organizations").select("name, is_active").eq("id", organizationId).maybeSingle<{ name: string; is_active: boolean }>();
  if (!org) return { error: "Organisation not found.", message: null };
  if (org.is_active === activate) return { error: `${org.name} is already ${activate ? "active" : "inactive"}.`, message: null };

  // deactivation_reason is a new column (migration 20261208000400) so it is not in the generated types yet.
  const patch = (activate ? { is_active: true } : { is_active: false, deactivation_reason: reason }) as { is_active: boolean };
  const { data: updated, error } = await supabase
    .from("organizations")
    .update(patch)
    .eq("id", organizationId)
    .eq("is_active", org.is_active)
    .select("id");
  if (error || !updated?.length) return { error: "Could not change the organisation status. Refresh and try again.", message: null };

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: activate ? "reactivated" : "deactivated",
    actorId: session.userId,
    summary: activate ? `Organisation "${org.name}" reactivated` : `Organisation "${org.name}" deactivated: ${reason}`,
    changes: { is_active: { from: org.is_active, to: activate }, ...(reason ? { reason } : {}) },
  });
  revalidateOrgPaths();
  return { error: null, message: activate ? `${org.name} reactivated.` : `${org.name} deactivated. Its projects are now read-only.` };
}

function revalidateOrgPaths() {
  revalidatePath("/inspect/organisation/clients");
  revalidatePath("/inspect/projects/new");
  revalidatePath("/inspect/organisation/numbering");
  revalidatePath("/inspect/organisation/staff-access");
  revalidatePath("/inspect/settings");
  revalidatePath("/inspect");
}
