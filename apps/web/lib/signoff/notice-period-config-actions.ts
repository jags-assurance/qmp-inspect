"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { NOTICE_PERIOD_CONFIGS_TABLE } from "./db-types";

export interface NoticePeriodConfigState {
  error: string | null;
}

/**
 * Writes the one tier of getNoticePeriodHours' resolution chain (lib/signoff/actions.ts) that has
 * had a table since phase 1 but no form to reach it: a project-wide notice-hours override for a
 * given intervention level, sitting between the per-activity override and the organisation's own
 * default_notice_hours. Staff-only, mirroring the table's own RLS
 * (notice_period_configs_staff_write: is_jags_staff(), not admin-only — same as itp_items_staff_write,
 * since this is ITP process setup any JAGS staff on the project can do, not an org-admin act).
 */
export async function setProjectNoticePeriodAction(
  _prev: NoticePeriodConfigState,
  formData: FormData
): Promise<NoticePeriodConfigState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can set a project's notice-period override." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const intervention = String(formData.get("intervention") ?? "").trim();
  const hoursRaw = String(formData.get("hours") ?? "").trim();

  if (!projectId || !intervention || !hoursRaw) {
    return { error: "Project, level and hours are required." };
  }
  const hours = Number.parseInt(hoursRaw, 10);
  if (Number.isNaN(hours) || hours < 0) {
    return { error: "Hours must be a non-negative number." };
  }

  const supabase = await createSupabaseServerClient();

  // Same upsert-by-conflict-target shape as the rest of the app's per-project config writes — one
  // row per (project_id, intervention), so re-setting a level just replaces its hours.
  const { error } = await supabase
    .from(NOTICE_PERIOD_CONFIGS_TABLE)
    .upsert({ project_id: projectId, intervention, hours }, { onConflict: "project_id,intervention" });

  if (error) {
    // The validate_notice_period_intervention_code trigger (20260917090000_configurable_
    // intervention_levels.sql) raises when `intervention` isn't one of this project's own
    // organisation's configured level codes — surface that rather than a raw DB error.
    return { error: "Could not save the notice-period override. Check the level code is valid for this organisation." };
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
        entityType: "notice_period_config",
        entityId: projectId,
        action: "set",
        actorId: session.userId,
        summary: `Project notice period for "${intervention}" set to ${hours}h`,
        changes: { project_id: projectId, intervention, hours },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}

export async function clearProjectNoticePeriodAction(
  _prev: NoticePeriodConfigState,
  formData: FormData
): Promise<NoticePeriodConfigState> {
  const session = await requireSession();
  if (!session.isJagsStaff) {
    return { error: "Only JAGS staff can clear a project's notice-period override." };
  }

  const projectId = String(formData.get("project_id") ?? "").trim();
  const intervention = String(formData.get("intervention") ?? "").trim();
  if (!projectId || !intervention) {
    return { error: "Missing project or level." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(NOTICE_PERIOD_CONFIGS_TABLE)
    .delete()
    .eq("project_id", projectId)
    .eq("intervention", intervention);

  if (error) {
    return { error: "Could not clear the override." };
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
        entityType: "notice_period_config",
        entityId: projectId,
        action: "cleared",
        actorId: session.userId,
        summary: `Project notice period override for "${intervention}" cleared`,
        changes: { project_id: projectId, intervention },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/projects/${projectId}`);
  return { error: null };
}
