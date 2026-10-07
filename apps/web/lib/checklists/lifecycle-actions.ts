"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { BACKGROUND_JOBS_TABLE } from "@/lib/reports/types";
import { supersedeIrnVaultDocuments } from "@/lib/vault/irn-void";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { buildReopenSnapshot } from "./review-logic";
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
    .select("id, project_id, record_number, inspector_id, overall_result, signed_by_name, signed_at, notes, itp_item_id, checklist_template_id, inspector_signature, witness_name, witness_signature")
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
      itp_item_id: string;
      checklist_template_id: string | null;
      inspector_signature: string | null;
      witness_name: string | null;
      witness_signature: string | null;
    }>();
  if (!record) return { error: "Inspection record not found." };
  if (!record.overall_result) return { error: "This inspection is not completed, so there is nothing to re-open." };

  // Re-opening is a controlled amendment: admin staff or a lead of a team assigned to this project.
  if (!isAdminStaff(session) && !(await isTeamLeadForProject(supabase, session.userId, record.project_id))) {
    return { error: "Only an admin or a team lead on this project can re-open a completed inspection." };
  }

  // One open draft per checklist: block re-opening while another draft is in progress.
  {
    let draftQuery = supabase
      .from("inspection_records")
      .select("id, record_number")
      .eq("itp_item_id", record.itp_item_id)
      .is("overall_result", null)
      .neq("id", record.id)
      .limit(1);
    draftQuery = record.checklist_template_id ? draftQuery.eq("checklist_template_id", record.checklist_template_id) : draftQuery;
    const { data: openDraft } = await draftQuery.maybeSingle<{ id: string; record_number: string }>();
    if (openDraft) {
      return { error: `Can't re-open: an open draft inspection (${openDraft.record_number}) already exists for this checklist. Complete or discard it first.` };
    }
  }

  // Preferred: one transaction re-opens the record, writes the amendment history, voids the live IRN and
  // supersedes the filed inspection report / IRN certificate (reopen_inspection RPC). Falls back to the
  // step-by-step path below until that migration is applied.
  let voidedIrnNumber: string | null = null;
  let reopenedViaRpc = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  const rpc = await (supabase.rpc as any)("reopen_inspection", { p_record_id: record.id, p_reason: reason });
  if (!rpc.error) {
    reopenedViaRpc = true;
    voidedIrnNumber = (rpc.data as { voided_irn?: string | null } | null)?.voided_irn ?? null;
    if (voidedIrnNumber) await supersedeIrnVaultDocuments(supabase, record.project_id, voidedIrnNumber);
  } else if (!(rpc.error.code === "42883" || rpc.error.code === "PGRST202" || /could not find the function/i.test(rpc.error.message ?? ""))) {
    console.error("[reopen] reopen_inspection failed", rpc.error.message);
    return { error: /already re-opened/i.test(rpc.error.message ?? "") ? "This inspection was already re-opened." : "The inspection could not be re-opened. Nothing was changed - try again." };
  }
  const voidReason = `Inspection re-opened: ${reason}`;

  if (!reopenedViaRpc) {
  // Snapshot of the answers / signatures / review decision being cleared (20261106000300 columns).
  const { data: snapResponses } = await untypedFrom(supabase, "checklist_responses")
    .select("checklist_item_id, result, comment, checklist_items(item_number, description, sort_order)")
    .eq("inspection_record_id", record.id);
  const { data: reviewRow } = await untypedFrom(supabase, "inspection_records").select("review_status").eq("id", record.id).maybeSingle();
  const snapshot = buildReopenSnapshot({
    responses: ((snapResponses ?? []) as {
      checklist_item_id: string;
      result: string;
      comment: string | null;
      checklist_items: { item_number: string; description: string; sort_order: number } | null;
    }[]).map((r) => ({
      checklist_item_id: r.checklist_item_id,
      result: r.result,
      comment: r.comment,
      item_number: r.checklist_items?.item_number,
      description: r.checklist_items?.description,
      sort_order: r.checklist_items?.sort_order,
    })),
    inspectorSignature: record.inspector_signature,
    witnessName: record.witness_name,
    witnessSignature: record.witness_signature,
    reviewStatus: (reviewRow as { review_status?: "approved" | "rejected" | null } | null)?.review_status ?? null,
  });

  // 1) Null the result first (conditional on still being completed). Only on success do the IRN void
  //    and the amendment row follow, so a failed re-open never voids a released document.
  const { data: reopened, error: updError } = await untypedFrom(supabase, "inspection_records")
    .update({
      overall_result: null,
      inspector_signature: null,
      signed_by_name: null,
      signed_by_user_id: null,
      signed_at: null,
      witness_name: null,
      witness_signature: null,
    })
    .eq("id", record.id)
    .not("overall_result", "is", null)
    .select("id");
  if (updError) return { error: "The inspection could not be re-opened. Try again." };
  if (!reopened || reopened.length === 0) return { error: "This inspection was already re-opened." };

  const amendmentRow = {
    record_id: record.id,
    amended_by: session.userId,
    reason,
    previous_overall_result: record.overall_result,
    previous_signed_by_name: record.signed_by_name,
    previous_signed_at: record.signed_at,
    previous_notes: record.notes,
  };
  let { error: histError } = await untypedFrom(supabase, "inspection_record_amendments").insert({ ...amendmentRow, ...snapshot });
  if (histError && isMissingSchemaError(histError)) {
    // Snapshot migration not applied yet: keep the original behaviour.
    ({ error: histError } = await untypedFrom(supabase, "inspection_record_amendments").insert(amendmentRow));
  }
  if (histError) {
    // Roll the re-open back so no un-logged amendment exists.
    await untypedFrom(supabase, "inspection_records")
      .update({
        overall_result: record.overall_result,
        inspector_signature: record.inspector_signature,
        signed_by_name: record.signed_by_name,
        signed_at: record.signed_at,
        witness_name: record.witness_name,
        witness_signature: record.witness_signature,
      })
      .eq("id", record.id);
    return { error: "Could not save the amendment history, so the inspection was not re-opened." };
  }

  // A re-opened inspection must be reviewed again (no-op until the review migration is applied).
  await untypedFrom(supabase, "inspection_records")
    .update({ review_status: null, reviewed_by: null, reviewed_at: null, review_comment: null })
    .eq("id", record.id);

  // 2) Void a live IRN so a released document never outlives its re-opened inspection.
  const { data: irn } = await supabase
    .from("irns")
    .select("id, irn_number, voided_at")
    .eq("inspection_record_id", record.id)
    .is("voided_at", null)
    .limit(1)
    .maybeSingle<{ id: string; irn_number: string; voided_at: string | null }>();
  if (irn && !irn.voided_at) {
    const { data: voided } = await untypedFrom(supabase, "irns")
      .update({ voided_at: new Date().toISOString(), voided_by: session.userId, void_reason: voidReason })
      .eq("id", irn.id)
      .is("voided_at", null)
      .select("id");
    if (voided?.length) {
      voidedIrnNumber = irn.irn_number;
      await supersedeIrnVaultDocuments(supabase, record.project_id, irn.irn_number);
    } else {
      // A live IRN must never outlive a re-opened inspection: put the record back and report it.
      await untypedFrom(supabase, "inspection_records")
        .update({
          overall_result: record.overall_result,
          inspector_signature: record.inspector_signature,
          signed_by_name: record.signed_by_name,
          signed_at: record.signed_at,
          witness_name: record.witness_name,
          witness_signature: record.witness_signature,
        })
        .eq("id", record.id);
      return { error: "The live IRN could not be voided, so the inspection was not re-opened. Try again or ask an admin." };
    }
  }

  }

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
  if (voidedIrnNumber) {
    // Stamp the previously issued IRN PDF as VOID (best-effort).
    try {
      const { data: v } = await supabase.from("irns").select("id").eq("inspection_record_id", record.id).eq("irn_number", voidedIrnNumber).maybeSingle<{ id: string }>();
      if (v) await supabase.from(BACKGROUND_JOBS_TABLE).insert({ job_type: "render_irn_pdf", payload: { irn_id: v.id, requested_by: session.userId } });
    } catch {
      // Best-effort.
    }
  }

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
  /** Snapshot of the answers / signatures cleared by the re-open (null for amendments made before it existed). */
  previous_responses?: { checklist_item_id: string; item_number: string | null; description: string | null; result: string; comment: string | null }[] | null;
  previous_inspector_signature?: string | null;
  previous_witness_name?: string | null;
  previous_witness_signature?: string | null;
  previous_review_status?: string | null;
  users: { full_name: string } | null;
}

/** Amendment history for one inspection (RLS-scoped read), newest first. */
export async function listInspectionAmendments(recordId: string): Promise<InspectionAmendment[]> {
  const supabase = await createSupabaseServerClient();
  const base = "id, amended_at, reason, previous_overall_result, previous_signed_by_name, previous_signed_at, users(full_name)";
  const snapshotCols = "previous_responses, previous_inspector_signature, previous_witness_name, previous_witness_signature, previous_review_status";
  let { data, error } = await untypedFrom(supabase, "inspection_record_amendments")
    .select(`${base}, ${snapshotCols}`)
    .eq("record_id", recordId)
    .order("amended_at", { ascending: false });
  if (error && isMissingSchemaError(error)) {
    ({ data } = await untypedFrom(supabase, "inspection_record_amendments").select(base).eq("record_id", recordId).order("amended_at", { ascending: false }));
  }
  return (data ?? []) as InspectionAmendment[];
}
