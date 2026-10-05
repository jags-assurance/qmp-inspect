"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { ENGAGEMENT_MODES, type EngagementMode } from "@jags/shared-types";
import { NUMBERING_CONFIGS_TABLE } from "./types";
import type { NumberingDocType } from "./types";

export interface NumberingSettingsState {
  error: string | null;
}

/**
 * RLS (organizations_staff_write / numbering_configs_staff_write) already stops any non-staff user
 * cold. The Admin/Inspector split below it is a business permission, not a tenant-isolation one — an
 * Inspector is still JAGS staff and RLS rightly leaves them able to write here — so it's enforced
 * here in the action, same pattern as itp-master's reviewProposalAction.
 */
export async function updateEngagementModeAction(
  _prev: NumberingSettingsState,
  formData: FormData
): Promise<NumberingSettingsState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change engagement mode or numbering settings." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const engagementModeInput = String(formData.get("engagement_mode") ?? "").trim();

  if (!organizationId || !engagementModeInput) {
    return { error: "Organisation and engagement mode are required." };
  }

  if (!(ENGAGEMENT_MODES as readonly string[]).includes(engagementModeInput)) {
    return { error: "Unrecognised engagement mode." };
  }
  const engagementMode = engagementModeInput as EngagementMode;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({ engagement_mode: engagementMode })
    .eq("id", organizationId);

  if (error) {
    return { error: "Could not update the engagement mode. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "engagement_mode_updated",
    actorId: session.userId,
    summary: `Engagement mode set to ${engagementMode}`,
    changes: { engagement_mode: engagementMode },
  });

  revalidatePath("/inspect/organisation/numbering");
  return { error: null };
}

const ENGAGEMENT_SCOPES = ["full_service", "self_managed", "client_managed"] as const;
type EngagementScope = (typeof ENGAGEMENT_SCOPES)[number];

/**
 * Self-Managed/Platform-Only client tier (supabase/migrations/
 * 20260918010000_self_managed_engagement_scope.sql) — a separate axis from engagement_mode
 * (branding only). 'self_managed' lets that org's client-type parties create and execute ITPs on
 * EVERY one of their projects without an Admin having to opt each project in individually via
 * projects.allow_client_execution / allow_client_itp_creation.
 */
export async function updateEngagementScopeAction(
  _prev: NumberingSettingsState,
  formData: FormData
): Promise<NumberingSettingsState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change engagement scope." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const engagementScopeInput = String(formData.get("engagement_scope") ?? "").trim();

  if (!organizationId || !engagementScopeInput) {
    return { error: "Organisation and engagement scope are required." };
  }
  if (!(ENGAGEMENT_SCOPES as readonly string[]).includes(engagementScopeInput)) {
    return { error: "Unrecognised engagement scope." };
  }
  const engagementScope = engagementScopeInput as EngagementScope;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({ engagement_scope: engagementScope })
    .eq("id", organizationId);

  if (error) {
    return { error: "Could not update engagement scope. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "engagement_scope_updated",
    actorId: session.userId,
    summary: `Engagement scope set to ${engagementScope}`,
    changes: { engagement_scope: engagementScope },
  });

  revalidatePath("/inspect/organisation/numbering");
  return { error: null };
}

/**
 * Admin-only for a full_service org — but a Self-Managed client can configure its OWN organization's
 * document numbering format (20260919050000_self_managed_org_settings.sql), matching "the client
 * manages its own organization." Numbering format is cosmetic/administrative, unlike
 * engagement_mode/engagement_scope above, which stay JAGS-only (branding arrangement and service
 * tier are JAGS/commercial decisions, not something a client declares for itself).
 */
export async function upsertNumberingConfigAction(
  _prev: NumberingSettingsState,
  formData: FormData
): Promise<NumberingSettingsState> {
  const session = await requireSession();
  const organizationId = String(formData.get("organization_id") ?? "").trim();

  if (!isAdminStaff(session)) {
    const supabase = await createSupabaseServerClient();
    const { data: org } = await supabase
      .from("organizations")
      .select("engagement_scope")
      .eq("id", organizationId)
      .maybeSingle<{ engagement_scope: string }>();
    if (org?.engagement_scope !== "self_managed" && org?.engagement_scope !== "client_managed") {
      return { error: "Only a JAGS Admin can change this organisation's numbering settings." };
    }
  }

  const docType = String(formData.get("doc_type") ?? "").trim() as NumberingDocType;
  const clientCode = String(formData.get("client_code") ?? "").trim();
  const originatorCode = String(formData.get("originator_code") ?? "JAGS").trim() || "JAGS";
  const separator = String(formData.get("separator") ?? "-").trim() || "-";
  const sequencePaddingRaw = String(formData.get("sequence_padding") ?? "3").trim();
  const includeYear = formData.get("include_year") === "on";
  const includeDiscipline = formData.get("include_discipline") === "on";

  const sequencePadding = Number.parseInt(sequencePaddingRaw, 10);

  if (!organizationId || !docType || !clientCode || Number.isNaN(sequencePadding) || sequencePadding < 1 || sequencePadding > 10) {
    return { error: "Client code and a sequence padding between 1 and 10 are required." };
  }

  const supabase = await createSupabaseServerClient();
  // Org-level config only (project_id null) — per-project overrides aren't exposed in this
  // settings screen, only the org-wide default per doc type.
  // A plain upsert can't target the org-level row: project_id is NULL, and NULLs never collide on
  // the (organization_id, project_id, doc_type) unique key, so each save inserted a duplicate.
  // Find the org-level row first, then update it, or insert if none exists.
  const values = {
    client_code: clientCode,
    originator_code: originatorCode,
    separator,
    sequence_padding: sequencePadding,
    include_year: includeYear,
    include_discipline: includeDiscipline,
  };
  const { data: existing } = await supabase
    .from(NUMBERING_CONFIGS_TABLE)
    .select("id")
    .eq("organization_id", organizationId)
    .is("project_id", null)
    .eq("doc_type", docType)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();
  const { data: config, error } = existing
    ? await supabase.from(NUMBERING_CONFIGS_TABLE).update(values).eq("id", existing.id).select("id").single<{ id: string }>()
    : await supabase
        .from(NUMBERING_CONFIGS_TABLE)
        .insert({ organization_id: organizationId, project_id: null, doc_type: docType, ...values })
        .select("id")
        .single<{ id: string }>();

  if (error) {
    return { error: "Could not save the numbering config. Check you have permission and try again." };
  }

  if (config?.id) {
    await recordAuditEvent(supabase, {
      organizationId,
      entityType: "numbering_config",
      entityId: config.id,
      action: "updated",
      actorId: session.userId,
      summary: `Numbering config for ${docType} updated`,
      changes: { doc_type: docType, client_code: clientCode, originator_code: originatorCode },
    });
  }

  revalidatePath("/inspect/organisation/numbering");
  return { error: null };
}
