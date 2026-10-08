"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { untypedFrom, untypedRpc } from "@/lib/supabase/untyped";
import { isMissingDbObject } from "@/lib/databook/db-errors";
import { RETENTION_SETTINGS_TABLE, parseRetentionReview, parseRetentionYears, reviewErrorMessage } from "./logic";

export interface RetentionState {
  error: string | null;
  success?: string | null;
}

const NEEDS_MIGRATION = "Retention rules need the latest database update (migration 20261112000103). Ask a JAGS Admin to apply it.";

/**
 * Admin-only: sets (or switches off) an organisation's document retention period. This only controls
 * which documents the worker flags for review; it never deletes or changes a document.
 */
export async function saveRetentionSettingsAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can change retention rules." };

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  if (!organizationId) return { error: "Missing organisation." };
  const enabled = formData.get("enabled") === "on";
  const parsed = parseRetentionYears(String(formData.get("retention_years") ?? ""));
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await untypedFrom(supabase, RETENTION_SETTINGS_TABLE).upsert(
    { organization_id: organizationId, retention_years: parsed.years, enabled, updated_by: session.userId, updated_at: new Date().toISOString() },
    { onConflict: "organization_id" }
  );
  if (error) {
    if (isMissingDbObject(error)) return { error: NEEDS_MIGRATION };
    return { error: "Could not save the retention rule. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId,
    entityType: "organization",
    entityId: organizationId,
    action: "retention_updated",
    actorId: session.userId,
    summary: enabled ? `Document retention set to ${parsed.years} year${parsed.years === 1 ? "" : "s"}` : `Document retention switched off (period kept at ${parsed.years} years)`,
    changes: { retention_years: parsed.years, enabled },
  });

  revalidatePath("/inspect/settings");
  revalidatePath("/inspect/organisation/retention");
  return { error: null, success: enabled ? "Retention rule saved. Documents past it are flagged by the daily sweep." : "Retention is switched off for this organisation." };
}

/** Admin-only: records the human decision on a flagged document (keep, or disposal approved). The document itself is never touched. */
export async function reviewRetentionFlagAction(_prev: RetentionState, formData: FormData): Promise<RetentionState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS Admin can review a retention flag." };

  const documentId = String(formData.get("document_id") ?? "").trim();
  if (!documentId) return { error: "Missing document." };
  const review = parseRetentionReview(String(formData.get("outcome") ?? ""), String(formData.get("note") ?? ""));
  if (!review.ok) return { error: review.error };

  const supabase = await createSupabaseServerClient();
  const { error } = await untypedRpc(supabase, "review_retention_flag", {
    p_document_id: documentId,
    p_outcome: review.outcome,
    p_note: review.note,
  });
  if (error) {
    if (isMissingDbObject(error)) return { error: NEEDS_MIGRATION };
    return { error: reviewErrorMessage(error.message) };
  }

  const { data: flag } = await untypedFrom(supabase, "vault_retention_flags")
    .select("organization_id, project_id")
    .eq("document_id", documentId)
    .maybeSingle<{ organization_id: string; project_id: string }>();
  if (flag) {
    await recordAuditEvent(supabase, {
      organizationId: flag.organization_id,
      projectId: flag.project_id,
      entityType: "vault_document",
      entityId: documentId,
      action: review.outcome === "keep" ? "retention_kept" : "retention_disposal_approved",
      actorId: session.userId,
      summary: review.outcome === "keep" ? "Retention review: document kept" : "Retention review: disposal approved (the document itself was not changed)",
      changes: { note: review.note },
    });
  }

  revalidatePath("/inspect/settings");
  revalidatePath("/inspect/organisation/retention");
  return { error: null, success: "Review recorded." };
}
