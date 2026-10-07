"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { unnotifiedNonBlockingLevels, validateWaiverReason, WAIVABLE_INTERVENTION } from "./notice-waiver";

export interface WaiveNoticeState {
  error: string | null;
  done?: boolean;
}

/**
 * JAGS staff record a written waiver for a Witness point whose party was never notified, so ONE draft
 * inspection can complete (S4-07). Append-only and audited. The database insert policy repeats the
 * staff / draft-only / project-access rules.
 */
export async function waiveWitnessNoticeAction(_prev: WaiveNoticeState, formData: FormData): Promise<WaiveNoticeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can waive a witness notice." };

  const recordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!recordId) return { error: "Missing inspection record." };
  const parsed = validateWaiverReason(String(formData.get("reason") ?? ""));
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createSupabaseServerClient();
  const { data: record } = await supabase
    .from("inspection_records")
    .select("id, project_id, itp_item_id, record_number, overall_result, projects(organization_id)")
    .eq("id", recordId)
    .maybeSingle<{ id: string; project_id: string; itp_item_id: string; record_number: string; overall_result: string | null; projects: { organization_id: string } | null }>();
  if (!record) return { error: "Inspection not found, or you do not have access to it." };
  if (record.overall_result) return { error: "This inspection is already completed." };

  const pending = await unnotifiedNonBlockingLevels(supabase, record.itp_item_id, record.id);
  if (pending.length === 0) return { error: "No un-notified witness point is blocking this inspection." };

  const { error } = await supabase.from("inspection_notice_waivers" as never).insert({
    inspection_record_id: record.id,
    project_id: record.project_id,
    intervention: WAIVABLE_INTERVENTION,
    reason: parsed.reason,
  } as never);
  if (error) {
    if (isMissingSchemaError(error)) return { error: "Waiving a notice needs a database update that has not been applied yet." };
    if (error.code === "23505") return { error: "A waiver is already recorded for this inspection." };
    return { error: "Could not record the waiver. Check you have permission and try again." };
  }

  const orgId = record.projects?.organization_id;
  if (orgId) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: orgId,
        projectId: record.project_id,
        entityType: "inspection_record",
        entityId: record.id,
        action: "witness_notice_waived",
        actorId: session.userId,
        summary: `Witness notice waived for ${record.record_number}: ${parsed.reason}`,
        changes: { intervention: WAIVABLE_INTERVENTION, reason: parsed.reason },
      });
    } catch {
      // Best-effort audit.
    }
  }

  revalidatePath(`/inspect/inspections/${record.id}`);
  return { error: null, done: true };
}
