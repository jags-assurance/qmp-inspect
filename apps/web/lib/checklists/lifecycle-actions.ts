"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { notifyAfterIrnVoided, notifyInspectorReopened } from "./irn-notifications";

// inspection_record_amendments is not in the generated shared-types yet; regenerate types and drop this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const untypedFrom = (client: Awaited<ReturnType<typeof createSupabaseServerClient>>, table: string) => (client as any).from(table);

export interface ReopenInspectionState {
  error: string | null;
}

/**
 * Re-opens (amends) a completed inspection. JAGS staff only, reason >= 15 chars. The original signed
 * result is copied to the insert-only inspection_record_amendments table first; then the result and
 * signatures are cleared (record becomes an editable draft) and any live IRN is voided.
 */
export async function reopenInspectionAction(_prev: ReopenInspectionState, formData: FormData): Promise<ReopenInspectionState> {
  const recordId = String(formData.get("inspection_record_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!recordId) return { error: "Missing inspection record." };
  if (reason.length < 15) return { error: "Give a reason for re-opening (at least 15 characters)." };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can re-open a completed inspection." };

  const supabase = await createSupabaseServerClient();
  const { data: record } = await supabase
    .from("inspection_records")
    .select("id, project_id, record_number, inspector_id, overall_result, signed_by_name, signed_at, notes")
    .eq("id", recordId)
    .maybeSingle<{
      id: string;
      project_id: string;
      record_number: string;
      inspector_id: string | null;
      overall_result: string | null;
      signed_by_name: string | null;
      signed_at: string | null;
      notes: string | null;
    }>();
  if (!record) return { error: "Inspection record not found." };
  if (!record.overall_result) return { error: "This inspection is not completed, so there is nothing to re-open." };

  const { error: histError } = await untypedFrom(supabase, "inspection_record_amendments").insert({
    record_id: record.id,
    amended_by: session.userId,
    reason,
    previous_overall_result: record.overall_result,
    previous_signed_by_name: record.signed_by_name,
    previous_signed_at: record.signed_at,
    previous_notes: record.notes,
  });
  if (histError) return { error: "Could not save the amendment history, so the inspection was not re-opened." };

  // Void a live IRN first so a released document never outlives its re-opened inspection.
  const voidReason = `Inspection re-opened: ${reason}`;
  const { data: irn } = await supabase
    .from("irns")
    .select("id, irn_number, voided_at")
    .eq("inspection_record_id", record.id)
    .maybeSingle<{ id: string; irn_number: string; voided_at: string | null }>();
  let voidedIrnNumber: string | null = null;
  if (irn && !irn.voided_at) {
    const { data: voided } = await untypedFrom(supabase, "irns")
      .update({ voided_at: new Date().toISOString(), voided_by: session.userId, void_reason: voidReason })
      .eq("id", irn.id)
      .is("voided_at", null)
      .select("id");
    if (voided?.length) voidedIrnNumber = irn.irn_number;
  }

  const { error: updError } = await untypedFrom(supabase, "inspection_records")
    .update({
      overall_result: null,
      inspector_signature: null,
      signed_by_name: null,
      signed_at: null,
      witness_name: null,
      witness_signature: null,
    })
    .eq("id", record.id);
  if (updError) return { error: "The amendment was logged but the record could not be re-opened. Try again." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string }>();

  await recordAuditEvent(supabase, {
    organizationId: project?.organization_id ?? null,
    projectId: record.project_id,
    entityType: "inspection_record",
    entityId: record.id,
    action: "reopened",
    actorId: session.userId,
    summary: `Inspection ${record.record_number} re-opened — ${reason}`,
    changes: {
      previous_overall_result: record.overall_result,
      previous_signed_by_name: record.signed_by_name,
      previous_signed_at: record.signed_at,
      irn_voided: voidedIrnNumber,
    },
  });

  await notifyInspectorReopened(supabase, record.id, record.inspector_id, reason);
  if (voidedIrnNumber) await notifyAfterIrnVoided(supabase, record.id, voidedIrnNumber, voidReason);

  revalidatePath(`/inspect/inspections/${record.id}`);
  return { error: null };
}

export interface InspectionAmendment {
  id: string;
  amended_at: string;
  reason: string;
  previous_overall_result: string | null;
  previous_signed_by_name: string | null;
  previous_signed_at: string | null;
  users: { full_name: string } | null;
}

/** Amendment history for one inspection (RLS-scoped read), newest first. */
export async function listInspectionAmendments(recordId: string): Promise<InspectionAmendment[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await untypedFrom(supabase, "inspection_record_amendments")
    .select("id, amended_at, reason, previous_overall_result, previous_signed_by_name, previous_signed_at, users(full_name)")
    .eq("record_id", recordId)
    .order("amended_at", { ascending: false });
  return (data ?? []) as InspectionAmendment[];
}
