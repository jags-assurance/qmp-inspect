"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { canExecuteItpItem, findProjectIdForItpItem } from "@/lib/checklists/execution-parties";
import { recordAuditEvent } from "@/lib/audit/log";

// Same pattern as lib/ai/log.ts's AI_USAGE_LOG_TABLE: these two tables aren't in the generated
// Database type yet (packages/shared-types/src/database.ts is hand-maintained until the next
// `pnpm db:types` run — see the README), so `.from()` can't resolve them against the Tables map.
// Casting the table name here is the one place that gap leaks in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_ITEM_MEASUREMENTS_TABLE = "itp_item_measurements" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE = "itp_item_evidence_documents" as any;

export type MeasurementResult = "pass" | "fail";

export interface ItpItemMeasurementRow {
  id: string;
  itp_item_id: string;
  description: string;
  nominal_value: string | null;
  tolerance: string | null;
  actual_value: string | null;
  unit: string | null;
  result: MeasurementResult | null;
  sort_order: number;
  recorded_by: string | null;
  created_at: string;
}

export interface ItpItemEvidenceDocumentRow {
  id: string;
  itp_item_id: string;
  vault_document_id: string;
  linked_by: string | null;
  created_at: string;
}

async function findItpIdForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itp_id)")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itp_id: string } | null }>();
  return data?.itp_sections?.itp_id ?? null;
}

export interface EvidenceActionState {
  error: string | null;
}

/**
 * Records one measurement/test-parameter row against an evidence_type=3 ("Measurement record")
 * ITP item — the field-execution mechanism that item type never had (see status/page.tsx's own
 * "No execution flow yet" comment). Same flat shape as standalone_assignment_measurements
 * (description/nominal/tolerance/actual/unit/result), reused deliberately rather than inventing a
 * second pattern for the same kind of data — see this migration's own header comment
 * (20260929040000_itp_item_evidence_execution.sql).
 *
 * Gated by canExecuteItpItem — the same "which party may execute this activity" rule checklist-type
 * items already use, generalized in lib/checklists/execution-parties.ts specifically so this file
 * could reuse it rather than re-deriving it.
 */
export async function addItpItemMeasurementAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nominalValue = String(formData.get("nominal_value") ?? "").trim();
  const tolerance = String(formData.get("tolerance") ?? "").trim();
  const actualValue = String(formData.get("actual_value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const resultRaw = String(formData.get("result") ?? "").trim();
  const result: MeasurementResult | null = resultRaw === "pass" || resultRaw === "fail" ? resultRaw : null;

  if (!itpItemId || !description) return { error: "A description is required." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only the party assigned to execute this activity (or JAGS staff) can record a measurement." };
  }

  const { count } = await supabase
    .from(ITP_ITEM_MEASUREMENTS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("itp_item_id", itpItemId);

  const { error } = await supabase.from(ITP_ITEM_MEASUREMENTS_TABLE).insert({
    itp_item_id: itpItemId,
    description,
    nominal_value: nominalValue || null,
    tolerance: tolerance || null,
    actual_value: actualValue || null,
    unit: unit || null,
    result,
    sort_order: count ?? 0,
    recorded_by: session.userId,
  });

  if (error) return { error: "Could not record the measurement. Check you have permission and try again." };

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
  return { error: null };
}

/**
 * Corrects a mis-entered measurement — staff can always remove any row, mirroring every other
 * delete gate in this app. A non-staff caller must additionally be the row's own recorder, not just
 * any active executing-type party on the activity: found in a self-review audit that
 * canExecuteItpItem alone checks "type + activity membership," not row ownership, so on an activity
 * with two executing parties (e.g. two subcontractors both linked via activity_party_intervention),
 * either could otherwise delete evidence the other one recorded.
 */
export async function deleteItpItemMeasurementAction(formData: FormData): Promise<void> {
  const measurementId = String(formData.get("measurement_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  if (!measurementId || !itpItemId) return;

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!session.isJagsStaff) {
    if (!(await canExecuteItpItem(supabase, itpItemId))) return;
    const { data: row } = await supabase
      .from(ITP_ITEM_MEASUREMENTS_TABLE)
      .select("recorded_by")
      .eq("id", measurementId)
      .maybeSingle<{ recorded_by: string | null }>();
    if (row?.recorded_by !== session.userId) return;
  }

  await supabase.from(ITP_ITEM_MEASUREMENTS_TABLE).delete().eq("id", measurementId);

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
}

/**
 * Links an existing vault document as this evidence_type=2 ("Document upload") item's own
 * completion evidence — the field-execution mechanism that item type never had. Deliberately reuses
 * the project's existing Vault (upload there first, same as the governing-drawing picker on
 * AddItemForm already does) rather than building a second upload UI/storage path here: a many-to-
 * many link table (itp_item_evidence_documents), not a new upload mechanism.
 *
 * Found missing in a self-review audit: the client-side picker (page.tsx) already scopes options to
 * this ITP's own project, but nothing re-checked that server-side, and the RLS insert policy on
 * itp_item_evidence_documents never joins vault_documents at all — so a crafted direct form-action
 * call (bypassing the picker entirely) could link a document from a different project a caller
 * happens to also have access to. Same audit found unapproved/superseded documents were linkable
 * too, satisfying this activity's completion requirement with no real evidence review behind it.
 * Both are now checked here, server-side, not just filtered out of the picker's option list.
 */
export async function linkItpItemEvidenceDocumentAction(_prev: EvidenceActionState, formData: FormData): Promise<EvidenceActionState> {
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const vaultDocumentId = String(formData.get("vault_document_id") ?? "").trim();
  if (!itpItemId || !vaultDocumentId) return { error: "Choose a document to link." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only the party assigned to execute this activity (or JAGS staff) can link evidence." };
  }

  const itemProjectId = await findProjectIdForItpItem(supabase, itpItemId);
  const { data: vaultDoc } = await supabase
    .from("vault_documents")
    .select("status, vault_folders(project_id)")
    .eq("id", vaultDocumentId)
    .maybeSingle<{ status: string; vault_folders: { project_id: string } | null }>();

  if (!vaultDoc || !itemProjectId || vaultDoc.vault_folders?.project_id !== itemProjectId) {
    return { error: "That document isn't in this activity's own project." };
  }
  if (vaultDoc.status !== "approved") {
    return { error: "Only an approved document can be linked as evidence — get it approved in the Document Vault first." };
  }

  const { error } = await supabase
    .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
    .insert({ itp_item_id: itpItemId, vault_document_id: vaultDocumentId, linked_by: session.userId });

  if (error) {
    return { error: error.code === "23505" ? "That document is already linked as evidence for this activity." : "Could not link the document." };
  }

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    const projectId = await findProjectIdForItpItem(supabase, itpItemId);
    try {
      const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId ?? "").maybeSingle<{ organization_id: string }>();
      if (project) {
        await recordAuditEvent(supabase, {
          organizationId: project.organization_id,
          projectId: projectId ?? undefined,
          entityType: "itp_item_evidence_document",
          entityId: itpItemId,
          action: "linked",
          actorId: session.userId,
          summary: "Evidence document linked to activity",
          changes: { vault_document_id: vaultDocumentId },
        });
      }
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
  return { error: null };
}

/**
 * Removes the link (never deletes the underlying vault document itself — it may still be
 * referenced elsewhere, e.g. as another activity's governing drawing). Same ownership check as
 * deleteItpItemMeasurementAction above, for the same reason: canExecuteItpItem alone doesn't tell
 * one executing party's link apart from another's on a shared activity.
 */
export async function unlinkItpItemEvidenceDocumentAction(formData: FormData): Promise<void> {
  const linkId = String(formData.get("link_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  if (!linkId || !itpItemId) return;

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  if (!session.isJagsStaff) {
    if (!(await canExecuteItpItem(supabase, itpItemId))) return;
    const { data: row } = await supabase
      .from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE)
      .select("linked_by")
      .eq("id", linkId)
      .maybeSingle<{ linked_by: string | null }>();
    if (row?.linked_by !== session.userId) return;
  }

  await supabase.from(ITP_ITEM_EVIDENCE_DOCUMENTS_TABLE).delete().eq("id", linkId);

  const itpId = await findItpIdForItem(supabase, itpItemId);
  if (itpId) {
    revalidatePath(`/inspect/itps/${itpId}`);
    revalidatePath(`/inspect/itps/${itpId}/status`);
  }
}
