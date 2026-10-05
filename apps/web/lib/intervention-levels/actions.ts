"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "./types";

export interface InterventionLevelState {
  error: string | null;
}

const SETTINGS_PATH = "/inspect/organisation/intervention-levels";

/**
 * Adds a new custom intervention level type for an organisation — the CEO's actual ask: a 5th
 * "Regulatory Compliance Review" level, or any other custom level, not just the built-in
 * Hold/Witness/Review/Surveillance four. RLS (intervention_level_types_admin_write) already
 * restricts writes to is_admin_staff(); this mirrors that at the action layer too, same pattern as
 * lib/numbering/actions.ts.
 */
export async function addInterventionLevelAction(
  _prev: InterventionLevelState,
  formData: FormData
): Promise<InterventionLevelState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can add or change intervention levels." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const codeInput = String(formData.get("code") ?? "").trim().toUpperCase();
  const label = String(formData.get("label") ?? "").trim();
  const isBlocking = formData.get("is_blocking") === "on";
  const noticeHoursRaw = String(formData.get("default_notice_hours") ?? "").trim();
  const sortOrderRaw = String(formData.get("sort_order") ?? "").trim();

  if (!organizationId || !codeInput || !label) {
    return { error: "Code and label are required." };
  }
  if (!/^[A-Z0-9]{1,8}$/.test(codeInput)) {
    return { error: "Code must be 1-8 letters/digits (e.g. CQR)." };
  }

  const defaultNoticeHours = noticeHoursRaw ? Number.parseInt(noticeHoursRaw, 10) : null;
  if (noticeHoursRaw && (Number.isNaN(defaultNoticeHours) || defaultNoticeHours! < 0)) {
    return { error: "Default notice hours must be a non-negative number." };
  }

  const supabase = await createSupabaseServerClient();

  let sortOrder = sortOrderRaw ? Number.parseInt(sortOrderRaw, 10) : NaN;
  if (Number.isNaN(sortOrder)) {
    const { data: existing } = await supabase
      .from(INTERVENTION_LEVEL_TYPES_TABLE)
      .select("sort_order")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .returns<{ sort_order: number }[]>();
    sortOrder = ((existing ?? [])[0]?.sort_order ?? 0) + 1;
  }

  const { data: level, error } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .insert({
      organization_id: organizationId,
      code: codeInput,
      label,
      is_blocking: isBlocking,
      default_notice_hours: defaultNoticeHours,
      sort_order: sortOrder,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !level) {
    if (error?.code === "23505") {
      return { error: `A level with code "${codeInput}" already exists for this organisation.` };
    }
    return { error: "Could not add the intervention level. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "intervention_level_type",
    entityId: level.id,
    action: "created",
    actorId: session.userId,
    summary: `Intervention level "${label}" (${codeInput}) added`,
  });

  revalidatePath(SETTINGS_PATH);
  return { error: null };
}

const ITP_SEQUENCING_MODES = ["flexible", "strict"] as const;

/**
 * R67: org-wide toggle between 'flexible' (today's default — only BLOCKING intervention levels
 * enforce sort_order among themselves; see findUnclearedLowerBlockingLevel in
 * lib/signoff/actions.ts) and 'strict' (every level, blocking or not, must clear in sort_order
 * order). Lives here rather than in lib/numbering/actions.ts because it's intervention-sequencing
 * config, same domain as the level types this file already manages — but is surfaced on the
 * Numbering settings page (revalidated below) alongside engagement mode/scope, its natural home in
 * the UI. Admin-only, same gating as every other write in this file.
 */
export async function updateItpSequencingModeAction(
  _prev: InterventionLevelState,
  formData: FormData
): Promise<InterventionLevelState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can change sequencing mode." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const modeInput = String(formData.get("itp_sequencing_mode") ?? "").trim();

  if (!organizationId || !modeInput) {
    return { error: "Organisation and sequencing mode are required." };
  }
  if (!(ITP_SEQUENCING_MODES as readonly string[]).includes(modeInput)) {
    return { error: "Unrecognised sequencing mode." };
  }
  const itpSequencingMode = modeInput as (typeof ITP_SEQUENCING_MODES)[number];

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("organizations")
    .update({ itp_sequencing_mode: itpSequencingMode })
    .eq("id", organizationId);

  if (error) {
    return { error: "Could not update sequencing mode. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "itp_sequencing_mode_updated",
    actorId: session.userId,
    summary: `ITP sequencing mode set to ${itpSequencingMode}`,
    changes: { itp_sequencing_mode: itpSequencingMode },
  });

  revalidatePath("/inspect/organisation/numbering");
  return { error: null };
}

/**
 * Renames/reorders/reclassifies an existing level (label, sort_order, is_blocking,
 * default_notice_hours). Deliberately does not accept a new `code` — the DB guards a code change on
 * an in-use level (prevent_intervention_level_type_code_change_in_use) but the settings UI never
 * offers changing it at all, since the code is what every activity_party_intervention/
 * activity_signoff_progress row actually keys on.
 */
export async function updateInterventionLevelAction(
  _prev: InterventionLevelState,
  formData: FormData
): Promise<InterventionLevelState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can add or change intervention levels." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const isBlocking = formData.get("is_blocking") === "on";
  const noticeHoursRaw = String(formData.get("default_notice_hours") ?? "").trim();
  const sortOrderRaw = String(formData.get("sort_order") ?? "").trim();

  if (!id || !label) {
    return { error: "Label is required." };
  }

  const defaultNoticeHours = noticeHoursRaw ? Number.parseInt(noticeHoursRaw, 10) : null;
  if (noticeHoursRaw && (Number.isNaN(defaultNoticeHours) || defaultNoticeHours! < 0)) {
    return { error: "Default notice hours must be a non-negative number." };
  }

  const sortOrder = Number.parseInt(sortOrderRaw, 10);
  if (Number.isNaN(sortOrder)) {
    return { error: "Sort order must be a number." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("organization_id")
    .eq("id", id)
    .maybeSingle<{ organization_id: string }>();

  const { data: updatedRows, error } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .update({ label, is_blocking: isBlocking, default_notice_hours: defaultNoticeHours, sort_order: sortOrder })
    .eq("id", id)
    .select("id");

  if (error || !updatedRows?.length) {
    return { error: "Could not update the intervention level. Check you have permission and try again." };
  }

  if (existing?.organization_id) {
    await recordAuditEvent(supabase, {
      organizationId: existing.organization_id,
      entityType: "intervention_level_type",
      entityId: id,
      action: "updated",
      actorId: session.userId,
      summary: `Intervention level "${label}" updated`,
      changes: { label, is_blocking: isBlocking, default_notice_hours: defaultNoticeHours, sort_order: sortOrder },
    });
  }

  revalidatePath(SETTINGS_PATH);
  return { error: null };
}

/**
 * Removes a level type — blocked at the DB layer (prevent_intervention_level_type_removal) if any
 * activity_party_intervention row anywhere in this organisation still uses its code, so an admin can
 * never silently orphan real sign-off data. That DB exception is caught here and turned into a plain
 * error message rather than a raw Postgres error string.
 */
export async function deleteInterventionLevelAction(
  _prev: InterventionLevelState,
  formData: FormData
): Promise<InterventionLevelState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can add or change intervention levels." };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Missing level." };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("organization_id, label")
    .eq("id", id)
    .maybeSingle<{ organization_id: string; label: string }>();

  const { data: deletedRows, error } = await supabase.from(INTERVENTION_LEVEL_TYPES_TABLE).delete().eq("id", id).select("id");

  if (!error && !deletedRows?.length) {
    return { error: "Could not remove the intervention level. Check you have permission and try again." };
  }
  if (error) {
    if (error.code === "P0001" || /in use/i.test(error.message ?? "")) {
      return { error: "This level is in use on at least one activity and cannot be removed." };
    }
    return { error: "Could not remove the intervention level. Check you have permission and try again." };
  }

  if (existing?.organization_id) {
    await recordAuditEvent(supabase, {
      organizationId: existing.organization_id,
      entityType: "intervention_level_type",
      entityId: id,
      action: "deleted",
      actorId: session.userId,
      summary: `Intervention level "${existing.label}" removed`,
    });
  }

  revalidatePath(SETTINGS_PATH);
  return { error: null };
}
