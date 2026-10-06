"use server";

import { notifyAfterIrnIssued, notifyAfterIrnVoided } from "./irn-notifications";
import { requireSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { computeCalibrationStatus, computeWelderStatus } from "@/lib/registers/status";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CHECKLIST_ITEMS_TABLE,
  CHECKLIST_RESPONSES_TABLE,
  CHECKLIST_TEMPLATES_TABLE,
  INSPECTION_EVIDENCE_DOCUMENTS_TABLE,
  INSPECTION_PHOTOS_TABLE,
  INSPECTION_RECORDS_TABLE,
  IRNS_TABLE,
  type ChecklistItemRow,
  type ChecklistResponseResult,
  type ChecklistResponseRow,
  type ChecklistTemplateRow,
  type InspectionEvidenceDocumentRow,
  type InspectionRecordRow,
  type OverallResult,
} from "./db-types";
import { canCompleteInspection } from "@/lib/signoff/actions";
import { getExecutingPartyTypes, findProjectIdForItpItem, canExecuteItpItem } from "./execution-parties";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import type { ChecklistItemDraft } from "@/lib/ai/provider";
import { nextSequenceNumber } from "@/lib/numbering/generate";
import { normaliseLocation } from "./location";
import { getLocationPresetsForProject } from "./location-presets";
import { validateChecklistItemsAnswered, computeOverallResult } from "./completion-logic";

export interface GenerateChecklistsState {
  error: string | null;
}

// canExecuteChecklistForItem moved to lib/checklists/execution-parties.ts as the generalized
// canExecuteItpItem — evidence_type=2/3 items (lib/itps/evidence-actions.ts) needed the exact same
// "which party may execute this activity" rule, which doesn't depend on what kind of evidence the
// activity produces. See that file's doc comment for the full R76 rationale (unchanged).

export interface GenerateChecklistsResult {
  error: string | null;
  created: number;
}

/**
 * Core checklist generation, shared by two callers with two different gating rules:
 *
 * 1. generateChecklistTemplatesAction (manual button) — only runs once an ITP is 'approved'
 *    (R48: checklists get their official numbers at approval, not draft).
 * 2. The "generate the whole ITP" flows — AI spec-to-ITP draft (lib/itps/ai-draft-actions.ts) and
 *    master-template copy (lib/itp-master/actions.ts) — call this immediately after the ITP's
 *    sections/items are inserted, with no status gate, per an explicit product decision: those two
 *    flows already have real, complete activities in hand (from the source vault documents or the
 *    master template) the moment the ITP exists, so there is no reason to make the user click
 *    through Draft -> Under Review -> Approved -> "Generate checklists" by hand before the ITP is
 *    field-usable. R48's numbering rule still holds for the plain manual "start from a blank ITP,
 *    add activities one at a time" path, which is the only path still gated on approval.
 *
 * Silently generates nothing (created: 0, error: null) for an ITP with no sections, no
 * evidence_type = 1 activities, or where every such activity already has a checklist — this is a
 * normal, non-error outcome for a caller that runs automatically right after creation, not just for
 * the manual button.
 */
export async function generateChecklistsForItp(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: { itpId: string; itpNumber: string; projectId: string; organizationId: string; userId: string | null }
): Promise<GenerateChecklistsResult> {
  const { itpId, itpNumber, projectId, organizationId, userId } = params;

  const { data: sections } = await supabase.from("itp_sections").select("id").eq("itp_id", itpId);
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (sectionIds.length === 0) return { error: null, created: 0 };

  const { data: items } = await supabase
    .from("itp_items")
    .select("id, activity, reference_spec, acceptance_criteria, method, frequency")
    .in("section_id", sectionIds)
    .eq("evidence_type", 1);

  if (!items || items.length === 0) return { error: null, created: 0 };

  const { data: existingTemplates } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("itp_item_id")
    .in(
      "itp_item_id",
      items.map((i) => i.id)
    )
    .returns<Pick<ChecklistTemplateRow, "itp_item_id">[]>();

  const alreadyTemplated = new Set((existingTemplates ?? []).map((t) => t.itp_item_id));
  const pending = items.filter((i) => !alreadyTemplated.has(i.id));

  if (pending.length === 0) return { error: null, created: 0 };

  // Real, field-usable checklist items — one AI call per activity, run in parallel. This is
  // gated the same way as every other AI feature (assertAiAllowed) and is best-effort per item:
  // an item the AI can't draft for (unavailable, malformed response) falls back to the single
  // "acceptance criteria as one item" placeholder rather than failing checklist generation
  // outright, so this action never regresses below what it did before AI was wired in.
  const gate = await assertAiAllowed(supabase, organizationId);
  // One ai_usage_log row PER ITEM (not one combined row for the whole batch, as this used to log)
  // — this is what lets caching work at the granularity that actually repeats: the same activity
  // text (a common master-template activity reused across many projects/ITPs) hashes identically
  // regardless of which ITP/batch it's generated for, so a later project's checklist generation can
  // reuse an earlier project's draft for that same activity without a fresh model call. See
  // lib/ai/cache.ts.
  let aiUsed = false;
  const itemsByPendingId = new Map(
    await Promise.all(
      pending.map(async (item) => {
        if (!gate.allowed) return [item.id, { drafted: null as ChecklistItemDraft[] | null, logId: null as string | null }] as const;
        const cacheInput = {
          activity: item.activity,
          referenceSpec: item.reference_spec ?? "",
          acceptanceCriteria: item.acceptance_criteria ?? "",
          method: item.method ?? "",
          frequency: item.frequency ?? "",
        };
        const inputHash = hashAiCacheInput(cacheInput);
        try {
          const cached = await findCachedAiResponse<ChecklistItemDraft[]>(supabase, {
            organizationId,
            feature: "checklist_generation",
            promptVersion: PROMPT_VERSIONS.checklist_generation,
            inputHash,
          });
          let usage: GeminiTokenUsage | null = null;
          let drafted: ChecklistItemDraft[];
          if (cached) {
            drafted = cached;
          } else {
            const captured = await withGeminiUsage(() =>
              geminiProvider.generateChecklistItems({ ...cacheInput, sourceExcerpt: "" })
            );
            drafted = captured.result;
            usage = captured.usage;
          }
          aiUsed = true;
          const logId = await logAiUsage(supabase, {
            organizationId,
            projectId,
            userId,
            feature: "checklist_generation",
            modelId: getGeminiModel("checklist_generation"),
            promptVersion: PROMPT_VERSIONS.checklist_generation,
            sourceRef: { itpId, itpItemId: item.id },
            aiResponse: drafted,
            inputHash,
            servedFromCache: !!cached,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
          });
          return [item.id, { drafted, logId }] as const;
        } catch {
          return [item.id, { drafted: null, logId: null }] as const;
        }
      })
    )
  );

  // Atomic per-ITP counter (race-free even if this action fires twice concurrently, e.g. a
  // double-click, or a later run adding checklists for newly-added items) rather than
  // (existingTemplates.length + 1), which two concurrent callers could both read before either
  // writes — see nextSequenceNumber. Sequential (not Promise.all) so checklist_number order
  // matches item order, since each call must await the previous one's DB round trip anyway.
  const payload: {
    itp_item_id: string;
    checklist_number: string;
    name: string;
    items: { item_number: string; description: string; is_mandatory: boolean; sort_order: number }[];
  }[] = [];

  for (const item of pending) {
    const seq = await nextSequenceNumber(supabase, {
      organizationId,
      projectId,
      seqKey: `checklist:${itpId}`,
    });
    const drafted = itemsByPendingId.get(item.id)?.drafted;
    const items =
      drafted && drafted.length > 0
        ? drafted.map((di, i) => ({ item_number: String(i + 1), description: di.text, is_mandatory: di.mandatory, sort_order: i }))
        : [
            {
              item_number: "1",
              description: item.acceptance_criteria ?? item.activity ?? "",
              is_mandatory: true,
              sort_order: 0,
            },
          ];
    payload.push({ itp_item_id: item.id, checklist_number: `${itpNumber}-CHK-${seq}`, name: item.activity, items });
  }

  // Single RPC call, one Postgres transaction (insert_checklists_atomic — see its migration for
  // why): every checklist_templates row and every checklist_items row for this run either all land
  // or none do, instead of a failed second insert silently leaving templates with no items behind.
  const { data: inserted, error: insertError } = await supabase.rpc("insert_checklists_atomic", { templates: payload });

  if (insertError || !inserted) {
    return { error: "Could not generate checklists. Check you have permission and try again.", created: 0 };
  }

  if (aiUsed && userId) {
    // One review-decision closure per item's own ai_usage_log row (see the generation loop above),
    // matched back to the template row insert_checklists_atomic actually created for that item —
    // finer-grained than the old single "checklist_batch" closure, and correct now that each item
    // has its own row rather than a shared one.
    const templateIdByItpItemId = new Map(inserted.map((t) => [t.itp_item_id, t.id]));
    await Promise.all(
      Array.from(itemsByPendingId.entries()).map(async ([itpItemId, { logId }]) => {
        const templateId = templateIdByItpItemId.get(itpItemId);
        if (!logId || !templateId) return;
        await recordAiReviewDecision(supabase, {
          logId,
          reviewedBy: userId,
          targetType: "checklist_template",
          targetId: templateId,
          reviewedResponse: { checklistTemplateId: templateId },
          decision: "accepted_as_is", // generated and persisted in one atomic step, no separate human-edit screen exists for this feature today
        });
      })
    );
  }

  return { error: null, created: inserted.length };
}

/**
 * Manual "Generate checklists" button on an approved ITP's checklists page. Still gated on
 * 'approved' — this is the one remaining path where an ITP can accumulate activities one at a time
 * over Draft/Under Review before checklists are wanted, so R48's "number at approval" rule still
 * applies here. See generateChecklistsForItp's doc comment for the two auto-generating flows that
 * intentionally do not have this gate.
 */
export async function generateChecklistTemplatesAction(
  _prev: GenerateChecklistsState,
  formData: FormData
): Promise<GenerateChecklistsState> {
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: itp } = await supabase
    .from("itps")
    .select("id, itp_number, status, project_id, projects(organization_id)")
    .eq("id", itpId)
    .maybeSingle<{
      id: string;
      itp_number: string;
      status: string;
      project_id: string;
      projects: { organization_id: string } | null;
    }>();

  if (!itp) return { error: "ITP not found." };
  if (itp.status !== "approved") return { error: "The ITP must be approved before checklists can be generated." };

  const result = await generateChecklistsForItp(supabase, {
    itpId,
    itpNumber: itp.itp_number,
    projectId: itp.project_id,
    organizationId: itp.projects?.organization_id ?? "",
    userId: user?.id ?? null,
  });

  if (result.error) return { error: result.error };
  if (result.created === 0) return { error: "Checklists already exist for every checklist-type activity, or this ITP has none." };

  if (itp.projects?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: itp.projects.organization_id,
        projectId: itp.project_id,
        entityType: "itp",
        entityId: itpId,
        action: "checklists_generated",
        actorId: user?.id ?? null,
        summary: `${result.created} checklist(s) generated for ITP ${itp.itp_number}`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/itps/${itpId}/checklists`);
  return { error: null };
}

export interface AddChecklistItemState {
  error: string | null;
}

export async function addChecklistItemAction(
  _prev: AddChecklistItemState,
  formData: FormData
): Promise<AddChecklistItemState> {
  const templateId = String(formData.get("template_id") ?? "").trim();
  const itemNumber = String(formData.get("item_number") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const isMandatory = formData.get("is_mandatory") === "on";

  if (!templateId || !itemNumber || !description) {
    return { error: "Item number and description are required." };
  }
  if (itemNumber.length > 20) return { error: "Item number is too long (maximum 20 characters)." };
  if (description.length > 500) return { error: "Description is too long (maximum 500 characters)." };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: tpl } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("itp_item_id")
    .eq("id", templateId)
    .maybeSingle<{ itp_item_id: string }>();
  if (!tpl) return { error: "Checklist not found." };
  if (!session.isJagsStaff && !(await canExecuteItpItem(supabase, tpl.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can add checklist items." };
  }
  // Once an inspection record exists for this checklist, its item set is frozen — adding an item
  // would silently change what "every item answered" means for a record already in progress or signed.
  const { count: usedCount } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("checklist_template_id", templateId);
  if (usedCount) {
    return { error: "This checklist is already in use by an inspection record — items can no longer be added." };
  }

  const { data: siblings } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .returns<Pick<ChecklistItemRow, "sort_order">[]>();

  const { error } = await supabase.from(CHECKLIST_ITEMS_TABLE).insert({
    template_id: templateId,
    item_number: itemNumber,
    description,
    is_mandatory: isMandatory,
    sort_order: (siblings?.[0]?.sort_order ?? -1) + 1,
  });

  if (error) {
    return { error: error.code === "23505" ? "That item number is already used on this checklist." : "Could not add the item." };
  }

  try {
    const { data: context } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("itp_item_id, itp_items(itp_sections(itps(project_id, projects(organization_id))))")
      .eq("id", templateId)
      .maybeSingle<{
        itp_item_id: string;
        itp_items: { itp_sections: { itps: { project_id: string; projects: { organization_id: string } | null } | null } | null } | null;
      }>();
    const itp = context?.itp_items?.itp_sections?.itps;
    const organizationId = itp?.projects?.organization_id;
    if (organizationId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await recordAuditEvent(supabase, {
        organizationId,
        projectId: itp?.project_id,
        entityType: "checklist_item",
        entityId: templateId,
        action: "item_added",
        actorId: user?.id ?? null,
        summary: `Checklist item ${itemNumber} added: ${description}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/checklists/${templateId}`);
  return { error: null };
}

export interface SaveChecklistResponseResult {
  error: string | null;
  /** Set when another user changed this answer since the client loaded it (offer "Reload"). */
  conflict?: { by: string | null; at: string | null };
  /** The row's new updated_at, to pass back as expected_updated_at on the next save. */
  updatedAt?: string;
}

/**
 * One checklist_responses upsert per item — auto-submitted from the field UI as the inspector taps
 * Yes/No/N-A, the same "no separate save step" pattern as setInterventionAction.
 *
 * Returns an explicit result rather than void: a permission failure (canExecuteChecklistForItem)
 * used to just return silently, which from the caller's side looked identical to a successful save
 * — no error, no thrown exception, just nothing — so a blocked response never told the user why.
 */
export async function saveChecklistResponseAction(formData: FormData): Promise<SaveChecklistResponseResult> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const checklistItemId = String(formData.get("checklist_item_id") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim() as ChecklistResponseResult;
  const comment = String(formData.get("comment") ?? "").trim();
  const calibrationAssetId = String(formData.get("calibration_asset_id") ?? "").trim();
  const materialId = String(formData.get("material_id") ?? "").trim();
  const welderId = String(formData.get("welder_id") ?? "").trim();
  const noNcrReason = String(formData.get("no_ncr_reason") ?? "").trim().slice(0, 500);
  const expectedUpdatedAt = String(formData.get("expected_updated_at") ?? "").trim();

  if (!inspectionRecordId || !checklistItemId || !result) {
    return { error: "Missing required fields — could not save your response." };
  }

  // R45: "a 'No' requires a comment" — enforced server-side, not just as a UI nudge, since this is
  // the record an auditor/NCR relies on later for why the item failed.
  if (result !== "yes" && result !== "no" && result !== "na") {
    return { error: "Invalid response value." };
  }
  if (result === "no" && !comment) {
    return { error: "A comment is required when marking an item as No." };
  }
  if (comment.length > 2000) {
    return { error: "Comment is too long (maximum 2000 characters)." };
  }

  const supabase = await createSupabaseServerClient();

  // Field execution is JAGS staff's job, or (R76) the party assigned to this specific activity
  // self-inspecting — the RLS write policy alone (has_org_access) would let any party with project
  // access answer a checklist item, so the restriction is enforced here too.
  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id, project_id, overall_result, checklist_template_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "project_id" | "overall_result" | "checklist_template_id">>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "Could not save — you don't have permission to record a response for this activity." };
  }
  if (record.overall_result) {
    return { error: "This inspection is already completed — responses can no longer be changed." };
  }
  // The item must belong to this inspection's own checklist (no cross-checklist writes).
  if (record.checklist_template_id) {
    const { data: itemRow } = await supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .select("id")
      .eq("id", checklistItemId)
      .eq("template_id", record.checklist_template_id)
      .maybeSingle<{ id: string }>();
    if (!itemRow) return { error: "That item is not part of this inspection's checklist." };
  }

  // Traceability links must point at a row on THIS project; calibration/welder must also be in date,
  // and material must be released. (Empty = not recorded, always allowed.)
  if (calibrationAssetId) {
    const { data: row } = await supabase
      .from("calibration_register")
      .select("due_date")
      .eq("id", calibrationAssetId)
      .eq("project_id", record.project_id)
      .maybeSingle<{ due_date: string }>();
    if (!row) return { error: "The selected instrument does not belong to this project." };
    if (computeCalibrationStatus(row.due_date) === "expired") {
      return { error: "The selected instrument's calibration has expired — choose an in-date instrument." };
    }
  }
  if (welderId) {
    const { data: row } = await supabase
      .from("welder_qualification_register")
      .select("expiry_date")
      .eq("id", welderId)
      .eq("project_id", record.project_id)
      .maybeSingle<{ expiry_date: string }>();
    if (!row) return { error: "The selected welder does not belong to this project." };
    if (computeWelderStatus(row.expiry_date) === "expired") {
      return { error: "The selected welder's qualification has expired — choose a qualified welder." };
    }
  }
  if (materialId) {
    const { data: row } = await supabase
      .from("material_register")
      .select("receipt_status")
      .eq("id", materialId)
      .eq("project_id", record.project_id)
      .maybeSingle<{ receipt_status: string }>();
    if (!row) return { error: "The selected material does not belong to this project." };
    if (row.receipt_status !== "released") {
      return { error: "The selected material has not been released at receiving inspection." };
    }
  }

  const payload = {
    inspection_record_id: inspectionRecordId,
    checklist_item_id: checklistItemId,
    result,
    comment: comment || null,
    calibration_asset_id: calibrationAssetId || null,
    material_id: materialId || null,
    welder_id: welderId || null,
    no_ncr_reason: result === "no" ? noNcrReason || null : null,
  };

  // Concurrent-edit detection: the client passes the updated_at it last saw ("none" = it saw no
  // row). Absent (offline replay / older clients) = last write wins, as before.
  const { data: existing } = await supabase
    .from(CHECKLIST_RESPONSES_TABLE)
    .select("id, updated_at, updated_by")
    .eq("inspection_record_id", inspectionRecordId)
    .eq("checklist_item_id", checklistItemId)
    .maybeSingle<{ id: string; updated_at: string; updated_by: string | null }>();

  const conflictResult = async (): Promise<SaveChecklistResponseResult> => {
    let by: string | null = null;
    const { data: latest } = await supabase
      .from(CHECKLIST_RESPONSES_TABLE)
      .select("updated_at, updated_by")
      .eq("inspection_record_id", inspectionRecordId)
      .eq("checklist_item_id", checklistItemId)
      .maybeSingle<{ updated_at: string; updated_by: string | null }>();
    if (latest?.updated_by) {
      const { data: u } = await supabase.from("users").select("full_name").eq("id", latest.updated_by).maybeSingle<{ full_name: string }>();
      by = u?.full_name ?? null;
    }
    return {
      error: `This answer was changed by ${by ?? "someone else"}${latest?.updated_at ? ` at ${new Date(latest.updated_at).toUTCString()}` : ""} since you opened it. Reload to see their version before overwriting.`,
      conflict: { by, at: latest?.updated_at ?? null },
    };
  };

  if (expectedUpdatedAt) {
    if (expectedUpdatedAt === "none" ? !!existing : !existing || new Date(existing.updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
      return conflictResult();
    }
  }

  let saved: { updated_at: string } | null = null;
  if (existing) {
    // Conditional on the row being unchanged since we read it, closing the read-then-write race.
    const { data: upd, error: updErr } = await supabase
      .from(CHECKLIST_RESPONSES_TABLE)
      .update(payload)
      .eq("id", existing.id)
      .eq("updated_at", existing.updated_at)
      .select("updated_at")
      .returns<{ updated_at: string }[]>();
    if (updErr) return { error: "Could not save your response. Check your connection and try again." };
    if (!upd || upd.length === 0) {
      if (expectedUpdatedAt) return conflictResult();
      // Last-write-wins path (no expectation supplied): retry once unconditionally.
      const { data: again, error: againErr } = await supabase
        .from(CHECKLIST_RESPONSES_TABLE)
        .update(payload)
        .eq("id", existing.id)
        .select("updated_at")
        .returns<{ updated_at: string }[]>();
      if (againErr) return { error: "Could not save your response. Check your connection and try again." };
      saved = again?.[0] ?? null;
    } else {
      saved = upd[0];
    }
  } else {
    const { data: ins, error: insErr } = await supabase
      .from(CHECKLIST_RESPONSES_TABLE)
      .insert(payload)
      .select("updated_at")
      .returns<{ updated_at: string }[]>();
    if (insErr) {
      // Unique violation = someone created it between our read and write.
      if (insErr.code === "23505" && expectedUpdatedAt) return conflictResult();
      return { error: "Could not save your response. Check your connection and try again." };
    }
    saved = ins?.[0] ?? null;
  }

  // Deliberately no revalidatePath here: ResponseRow already reflects the save optimistically via
  // its own local state, so a full-page RSC refetch on every single field blur bought nothing but
  // latency — with several sequential queries on this route (register verification, past records,
  // etc.), it made useTransition's isPending (the "Saving…" label) stay true for seconds after the
  // actual write had long since completed, reading as stuck to a real user. Other viewers still pick
  // up the change via the page's own RealtimeRefresh subscription on checklist_responses.
  return { error: null, updatedAt: saved?.updated_at };
}

export interface StartInspectionState {
  error: string | null;
}

/**
 * Opens an inspection_record for a checklist. The traceability header (project name, ITP number,
 * activity) is copied onto the row here, as plain text, rather than left to a live join — see the
 * migration file header for why.
 */
export async function startInspectionAction(
  _prev: StartInspectionState,
  formData: FormData
): Promise<StartInspectionState> {
  const templateId = String(formData.get("template_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  const projectName = String(formData.get("project_name") ?? "").trim();
  const itpNumber = String(formData.get("itp_number") ?? "").trim();
  const activity = String(formData.get("activity") ?? "").trim();
  const rawLocation = String(formData.get("location") ?? "").trim();

  if (!templateId || !itpItemId || !projectId || !projectName || !itpNumber || !activity) {
    return { error: "Missing required fields to start the inspection." };
  }

  if (rawLocation.length > 500) return { error: "The location is too long." };

  const supabase = await createSupabaseServerClient();
  // Location is one lat/lng pair, or one of the project's location presets — never a free place name.
  let location: string | null = null;
  {
    let presetNames: string[] = [];
    if (rawLocation) {
      const { data: proj } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
      if (proj) presetNames = (await getLocationPresetsForProject(supabase, proj.organization_id, projectId)).map((p) => p.name);
    }
    const norm = normaliseLocation(rawLocation, presetNames);
    if ("error" in norm) return { error: norm.error };
    location = norm.value;
  }
  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only JAGS staff or the party assigned to this activity can start a field inspection." };
  }

  // Server-side integrity: the template, activity and project must actually belong together (the
  // hidden form fields are client-supplied), and the ITP must be approved/accepted before work
  // starts — the same gate activity sign-off uses.
  const { data: gate } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id, itp_item_id, itp_items(itp_sections(itps(status, projects(id))))")
    .eq("id", templateId)
    .maybeSingle<{
      id: string;
      itp_item_id: string | null;
      itp_items: { itp_sections: { itps: { status: string; projects: { id: string } | null } | null } | null } | null;
    }>();
  if (!gate || gate.itp_item_id !== itpItemId || gate.itp_items?.itp_sections?.itps?.projects?.id !== projectId) {
    return { error: "This checklist does not belong to that activity or project." };
  }
  const itpStatus = gate.itp_items?.itp_sections?.itps?.status;
  if (itpStatus !== "approved" && itpStatus !== "client_accepted") {
    return { error: "This ITP hasn't been approved yet, so site inspections can't start. Work opens once the ITP is approved." };
  }

  // Resume rather than create a second draft for the same activity.
  {
    const { data: openDraft } = await supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id")
      .eq("itp_item_id", itpItemId)
      .eq("checklist_template_id", templateId)
      .is("overall_result", null)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (openDraft) {
      revalidatePath(`/inspect/checklists/${templateId}`);
      return { error: null };
    }
  }

  // R71: "Hold (H): work is genuinely held for that party until they respond/release. A hold point
  // must wait." This was previously only enforced at completeInspectionCore — a Hold blocked
  // filing the paperwork, but the physical work itself (opening the checklist, answering every
  // item, attaching photos) could already run start-to-finish first. Checking the same gate here,
  // before an inspection_record even exists, is what actually holds the work per R71, not just the
  // record of it — every checklist-item save requires an inspection_record_id (see
  // saveChecklistResponseAction), so blocking creation here blocks the whole downstream chain too.
  // R72/R73/R74 (Witness/Review/Surveillance) are deliberately unaffected: canCompleteInspection
  // only looks at is_blocking levels, so a Witness point never holds work, matching "notify-and-
  // proceed."
  //
  // Admin-configurable per project (20260921010000_project_hold_blocks_start_toggle.sql), default
  // on: not every project's process needs the software to hold the START of work, so a JAGS Admin
  // can opt a specific project out — the completion-time check right below stays in effect either
  // way, so a Hold is never entirely unenforced.
  const { data: projectSettings } = await supabase
    .from("projects")
    .select("enforce_hold_blocks_start")
    .eq("id", projectId)
    .maybeSingle<{ enforce_hold_blocks_start: boolean }>();

  if (projectSettings?.enforce_hold_blocks_start && !(await canCompleteInspection(itpItemId))) {
    return { error: "This activity has an open Hold — the assigned party must release it before the inspection can start." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string; organizations: { name: string } | null }>();

  // R64/R103/R125: freeze client name, applicable standard, and the governing drawing (if this
  // activity has one linked — see itp_items.governing_drawing_document_id) onto the record at
  // creation, same as project_name/itp_number/activity above — best-effort, all nullable, never
  // blocks starting the inspection.
  const { data: itpItemForHeader } = await supabase
    .from("itp_items")
    .select(
      "governing_drawing_document_id, itp_sections(itps(applicable_standard)), governing_drawing:vault_documents!governing_drawing_document_id(title, document_reference, revision)"
    )
    .eq("id", itpItemId)
    .maybeSingle<{
      governing_drawing_document_id: string | null;
      itp_sections: { itps: { applicable_standard: string | null } | null } | null;
      governing_drawing: { title: string; document_reference: string | null; revision: string } | null;
    }>();

  // Atomic per-ITP counter, same reasoning as checklist_number above — a plain count-then-insert
  // would let two inspectors starting a field inspection at the same moment collide on the same
  // INSP suffix.
  const seq = await nextSequenceNumber(supabase, {
    organizationId: project?.organization_id ?? "",
    projectId,
    seqKey: `inspection:${itpNumber}`,
  });

  // Per-ACTIVITY attempt count (distinct from the ITP-wide `seq` above) — drives the PDF's Document
  // Control "REV" field. Read-then-insert is fine here (unlike the shared seq counter): a double
  // count on a rare concurrent double-click just produces the same revision number twice, which is
  // cosmetic, not a collision on a unique record_number.
  const { count: priorAttempts } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("itp_item_id", itpItemId);

  const { error } = await supabase.from(INSPECTION_RECORDS_TABLE).insert({
    project_id: projectId,
    itp_item_id: itpItemId,
    checklist_template_id: templateId,
    record_number: `${itpNumber}-INSP-${seq}`,
    revision: priorAttempts ?? 0,
    project_name: projectName,
    itp_number: itpNumber,
    activity,
    location: location || null,
    inspector_id: user?.id ?? null,
    client_name: project?.organizations?.name ?? null,
    applicable_standard: itpItemForHeader?.itp_sections?.itps?.applicable_standard ?? null,
    governing_drawing_reference: itpItemForHeader?.governing_drawing
      ? itpItemForHeader.governing_drawing.document_reference ?? itpItemForHeader.governing_drawing.title
      : null,
    governing_drawing_revision: itpItemForHeader?.governing_drawing?.revision ?? null,
  });

  if (error) {
    return { error: "Could not start the inspection. Check you have permission and try again." };
  }

  if (project?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId,
        entityType: "inspection_record",
        entityId: itpItemId,
        action: "started",
        actorId: user?.id ?? null,
        summary: `Inspection started: ${activity} (${itpNumber})`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  revalidatePath(`/inspect/checklists/${templateId}`);
  return { error: null };
}

export interface CompleteInspectionState {
  error: string | null;
}

/**
 * Finalises an inspection: computes the overall result from the recorded responses (server-side,
 * not trusted from the client), stamps the signature and notes, then locks the record by giving it
 * a non-null overall_result. A fail result is a normal, expected outcome here: it auto-creates a
 * punch-list item and notifies the item's stakeholders below (R92-R96) — raising an NCR off it is
 * still a separate, manual step the inspector takes themselves (see the "Raise NCR" link on the
 * inspection page), this function doesn't do that part.
 */
/**
 * The validation + write logic shared by completeInspectionAction (the live form, which redirects
 * on success) and the offline-sync route handler (POST /api/offline-sync, which never redirects —
 * it's a background fetch, not a page navigation). Pulled out so both places enforce exactly the
 * same rules (Hold gating, every item answered) instead of the sync path re-implementing — and
 * potentially drifting from — the real one.
 */
const MIN_NO_EVIDENCE_REASON_LENGTH = 15;

export async function completeInspectionCore(formData: FormData): Promise<CompleteInspectionState & { inspectionRecordId?: string }> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();
  const rawNotes = String(formData.get("notes") ?? "").trim();
  // Explicit, written waiver for the rare inspection with genuinely nothing to attach (e.g. a pure
  // document-review check) — never silent: a real reason is required and is stamped into the
  // record's notes (so it shows on the report) and the audit trail below.
  const noEvidenceReason = String(formData.get("no_evidence_reason") ?? "").trim();
  const signature = String(formData.get("signature") ?? "").trim();
  const typedName = String(formData.get("signed_by_name") ?? "").trim().slice(0, 120);
  const witnessName = String(formData.get("witness_name") ?? "").trim().slice(0, 120);
  const witnessSignature = String(formData.get("witness_signature") ?? "").trim();

  if (!inspectionRecordId || !templateId) return { error: "Missing inspection record." };
  if (witnessSignature && !witnessName) return { error: "Enter the witness's name alongside their signature." };
  if (!signature) return { error: "A signature is required to complete the inspection." };

  const supabase = await createSupabaseServerClient();

  // Real gap found live: the "Photo evidence" section looked optional (no enforcement client- or
  // server-side), even though a completed inspection with zero evidence is close to worthless in a
  // dispute or ISO audit. At least one photo OR one linked Vault document — attached to the
  // inspection as a whole, or to any individual item — is now required to complete, mirroring the
  // signature check just above.
  const [{ count: photoCount }, { count: evidenceDocCount }] = await Promise.all([
    supabase.from(INSPECTION_PHOTOS_TABLE).select("id", { count: "exact", head: true }).eq("inspection_record_id", inspectionRecordId),
    supabase
      .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("inspection_record_id", inspectionRecordId),
  ]);
  const evidenceWaived = !photoCount && !evidenceDocCount && noEvidenceReason.length >= MIN_NO_EVIDENCE_REASON_LENGTH;
  if (!photoCount && !evidenceDocCount && !evidenceWaived) {
    return {
      error: noEvidenceReason
        ? `Explain why no evidence applies (at least ${MIN_NO_EVIDENCE_REASON_LENGTH} characters), or attach a photo or document.`
        : "At least one evidence photo or linked document is required to complete the inspection.",
    };
  }
  const notes = evidenceWaived ? `[No evidence attached — reason: ${noEvidenceReason}]${rawNotes ? `\n${rawNotes}` : ""}` : rawNotes;

  const { data: recordForAuth } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id">>();
  if (!recordForAuth || !(await canExecuteItpItem(supabase, recordForAuth.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can complete the inspection." };
  }

  // R66-R81: a Hold blocks inspection completion until the holding party has signed off.
  const { data: recordForHoldCheck } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id, project_id, activity, record_number")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "project_id" | "activity" | "record_number">>();

  if (recordForHoldCheck && !(await canCompleteInspection(recordForHoldCheck.itp_item_id))) {
    return { error: "This activity has an open Hold — it must be signed off before the inspection can be completed." };
  }

  const { data: items } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id")
    .eq("template_id", templateId)
    .returns<Pick<ChecklistItemRow, "id">[]>();
  const { data: responses } = await supabase
    .from(CHECKLIST_RESPONSES_TABLE)
    .select("checklist_item_id, result")
    .eq("inspection_record_id", inspectionRecordId)
    .returns<Pick<ChecklistResponseRow, "checklist_item_id" | "result">[]>();

  const itemIds = new Set((items ?? []).map((i) => i.id));
  const responseByItem = new Map((responses ?? []).map((r) => [r.checklist_item_id, r.result]));

  // Round-table finding: `.some()` over an empty set is vacuously false, so a checklist with zero
  // items (e.g. one created but never populated with items) would silently "complete" with
  // overall_result='pass' despite recording nothing at all — indistinguishable downstream from a
  // real, evidenced pass. A checklist must have at least one answered item to be completed. The
  // check itself lives in validateChecklistItemsAnswered (completion-logic.ts), pulled out so it's
  // unit-testable without a live DB — see lib/checklists/__tests__/completion-logic.test.ts.
  const validationError = validateChecklistItemsAnswered(itemIds, responseByItem);
  if (validationError) {
    return { error: validationError };
  }

  // Every "No" must be traced to a raised NCR/observation on this inspection, or carry an explicit
  // written reason for why none was raised. Clear error (also surfaced for queued offline completions).
  const noItemIds = [...responseByItem.entries()].filter(([, r]) => r === "no").map(([id]) => id);
  if (noItemIds.length > 0) {
    // Per-item: an NCR linked to that checklist item, or (backwards compatibility) an NCR on this
    // inspection with no checklist item link, or a written reason.
    const { data: ncrRows } = await supabase
      .from("ncrs")
      .select("checklist_item_id" as "id")
      .eq("inspection_record_id", inspectionRecordId)
      .returns<{ checklist_item_id: string | null }[]>();
    const linkedItemIds = new Set((ncrRows ?? []).map((n) => n.checklist_item_id).filter((v): v is string => !!v));
    const hasUnlinkedNcr = (ncrRows ?? []).some((n) => !n.checklist_item_id);
    {
      const { data: noRows } = await supabase
        .from(CHECKLIST_RESPONSES_TABLE)
        .select("checklist_item_id, no_ncr_reason")
        .eq("inspection_record_id", inspectionRecordId)
        .eq("result", "no")
        .returns<{ checklist_item_id: string; no_ncr_reason: string | null }[]>();
      const lacking = (noRows ?? []).filter(
        (r) =>
          !linkedItemIds.has(r.checklist_item_id) &&
          !hasUnlinkedNcr &&
          (r.no_ncr_reason ?? "").trim().length < 10
      );
      if (lacking.length > 0) {
        const { data: itemRows } = await supabase
          .from(CHECKLIST_ITEMS_TABLE)
          .select("id, item_number")
          .in("id", lacking.map((r) => r.checklist_item_id))
          .returns<{ id: string; item_number: string }[]>();
        const nums = (itemRows ?? []).map((i) => i.item_number).join(", ");
        return {
          error: `Raise an NCR/observation for the "No" answer(s) on item ${nums}, or record a written reason (at least 10 characters) for why none is needed, before completing.`,
        };
      }
    }
  }

  const results = [...responseByItem.values()];
  const overallResult: OverallResult = computeOverallResult(results);

  // .is("overall_result", null) makes this update conditional on the record still being open —
  // without it, a double-click or the offline-sync route replaying an at-least-once-delivered
  // "complete_inspection" item (see app/api/offline-sync/route.ts) could both pass the validation
  // above and both run, each independently creating a punch item and sending "Inspection failed"
  // notifications for the one real event. `.select("id")` lets us tell "updated" from "already
  // completed by someone/something else" apart, since a plain `error`-only check can't.
  const {
    data: { user: signer },
  } = await supabase.auth.getUser();
  let signedByName = typedName;
  if (!signedByName && signer?.id) {
    const { data: profile } = await supabase.from("users").select("full_name").eq("id", signer.id).maybeSingle<{ full_name: string }>();
    signedByName = profile?.full_name ?? "";
  }
  const { data: updated, error } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .update({
      overall_result: overallResult,
      notes: notes || null,
      inspector_signature: signature || null,
      signed_by_name: signedByName || null,
      signed_at: new Date().toISOString(),
      witness_name: witnessName || null,
      witness_signature: witnessSignature || null,
    })
    .eq("id", inspectionRecordId)
    .is("overall_result", null)
    .select("id");

  if (error) {
    return { error: "Could not complete the inspection. Check you have permission and try again." };
  }
  if (!updated || updated.length === 0) {
    return { error: "This inspection has already been completed." };
  }

  // Best-effort: the audit trail is a convenience layer on top of the real, already-succeeded
  // completion above — see lib/audit/log.ts's doc comment.
  if (recordForHoldCheck) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: context } = await supabase
        .from("itp_items")
        .select("itp_sections(itps(projects(organization_id)))")
        .eq("id", recordForHoldCheck.itp_item_id)
        .maybeSingle<{
          itp_sections: { itps: { projects: { organization_id: string } | null } | null } | null;
        }>();

      const organizationId = context?.itp_sections?.itps?.projects?.organization_id;
      if (organizationId) {
        await recordAuditEvent(supabase, {
          organizationId,
          projectId: recordForHoldCheck.project_id,
          entityType: "inspection_record",
          entityId: inspectionRecordId,
          action: "inspection_completed",
          actorId: user?.id ?? null,
          summary: `Inspection ${recordForHoldCheck.record_number} (${recordForHoldCheck.activity}) completed — ${overallResult}${evidenceWaived ? ` (completed with NO evidence attached: ${noEvidenceReason})` : ""}`,
        });
      }
    } catch {
      // Best-effort — see doc comment above.
    }
  }

  // R92-R96: a failed inspection feeds the project-wide punch list, not just the NCR the inspector
  // may separately raise — the punch list is what ultimately gates handover, so this needs to land
  // regardless of whether an NCR gets raised for the same failure.
  if (overallResult === "fail" && recordForHoldCheck) {
    await createPunchItemFromSource({
      projectId: recordForHoldCheck.project_id,
      description: `Failed inspection: ${recordForHoldCheck.activity} (${recordForHoldCheck.record_number})`,
      source: "inspection_failure",
      sourceInspectionRecordId: inspectionRecordId,
    });

    // Best-effort: let the ITP's preparer know their activity failed without them having to notice
    // it on the register. Never blocks inspection completion, which has already succeeded above.
    try {
      const { data: context } = await supabase
        .from("itp_items")
        .select("itp_sections(itps(prepared_by, projects(organization_id)))")
        .eq("id", recordForHoldCheck.itp_item_id)
        .maybeSingle<{
          itp_sections: {
            itps: {
              prepared_by: string | null;
              projects: { organization_id: string } | null;
            } | null;
          } | null;
        }>();

      const itp = context?.itp_sections?.itps;
      const organizationId = itp?.projects?.organization_id;

      if (organizationId) {
        // Real gap found live: this used to only notify the ITP's preparer — the actual party
        // responsible for redoing the failed work (whoever holds an intervention level on this
        // exact item, e.g. the executing contractor) never heard about it unless they happened to
        // check the register themselves. Notifying every party with a stake in this item (deduped
        // against the preparer so they don't get it twice) closes that gap without new schema —
        // activity_party_intervention already links each item to its parties, and project_parties
        // already links a party to its logged-in user, where one exists.
        const recipientIds = new Set<string>();
        if (itp?.prepared_by) recipientIds.add(itp.prepared_by);

        const { data: stakeholderParties } = await supabase
          .from("activity_party_intervention")
          .select("project_parties(user_id)")
          .eq("itp_item_id", recordForHoldCheck.itp_item_id)
          .returns<{ project_parties: { user_id: string | null } | null }[]>();
        for (const row of stakeholderParties ?? []) {
          if (row.project_parties?.user_id) recipientIds.add(row.project_parties.user_id);
        }

        await Promise.all(
          [...recipientIds].map((recipientUserId) =>
            createNotification(supabase, {
              organizationId,
              projectId: recordForHoldCheck.project_id,
              recipientUserId,
              title: "Inspection failed",
              body: `${recordForHoldCheck.activity} (${recordForHoldCheck.record_number})`,
              link: `/inspect/inspections/${inspectionRecordId}`,
            })
          )
        );
      }
    } catch {
      // Notification delivery is best-effort — see doc comment above.
    }
  }

  return { error: null, inspectionRecordId };
}

export async function completeInspectionAction(
  _prev: CompleteInspectionState,
  formData: FormData
): Promise<CompleteInspectionState> {
  const result = await completeInspectionCore(formData);
  if (result.error) return { error: result.error };
  redirect(`/inspect/inspections/${result.inspectionRecordId}`);
}

export interface CheckConsistencyState {
  error: string | null;
  flags: string[] | null;
}

const EMPTY_CONSISTENCY_STATE: CheckConsistencyState = { error: null, flags: null };

/**
 * Reqs R111: a purely advisory check, called from the checklist completion flow, asking whether
 * any recorded response looks inconsistent with the parent ITP item's acceptance criteria. Same
 * "assist never gates" principle as the register soft-stop above (checkRegisterVerification) —
 * this never blocks completeInspectionAction and is never called by it; it's a separate,
 * button-triggered check the inspector can run before they hit Complete inspection.
 */
export async function checkChecklistConsistencyAction(
  _prev: CheckConsistencyState,
  formData: FormData
): Promise<CheckConsistencyState> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();
  if (!inspectionRecordId) return { ...EMPTY_CONSISTENCY_STATE, error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("project_id, itp_item_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "project_id" | "itp_item_id">>();

  if (!record) return { ...EMPTY_CONSISTENCY_STATE, error: "Inspection record not found." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_CONSISTENCY_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_CONSISTENCY_STATE, error: gate.reason };

  const { data: itpItem } = await supabase
    .from("itp_items")
    .select("acceptance_criteria")
    .eq("id", record.itp_item_id)
    .maybeSingle<{ acceptance_criteria: string | null }>();

  const { data: items } = await supabase
    .from(CHECKLIST_ITEMS_TABLE)
    .select("id, description")
    .eq("template_id", templateId)
    .returns<Pick<ChecklistItemRow, "id" | "description">[]>();

  const { data: responses } = await supabase
    .from(CHECKLIST_RESPONSES_TABLE)
    .select("checklist_item_id, result, comment")
    .eq("inspection_record_id", inspectionRecordId)
    .returns<Pick<ChecklistResponseRow, "checklist_item_id" | "result" | "comment">[]>();

  const descriptionByItem = new Map((items ?? []).map((i) => [i.id, i.description]));
  const responseInputs = (responses ?? []).map((r) => ({
    itemDescription: descriptionByItem.get(r.checklist_item_id) ?? "",
    result: r.result,
    comment: r.comment,
  }));

  if (responseInputs.length === 0) {
    return { error: null, flags: [] };
  }

  try {
    // Re-clicking "check consistency" with no answers changed since the last check (a real,
    // observed pattern — nothing here auto-runs it) hits this cache instead of a fresh call.
    const inputHash = hashAiCacheInput({ acceptanceCriteria: itpItem?.acceptance_criteria ?? "", responses: responseInputs });
    const cached = await findCachedAiResponse<string[]>(supabase, {
      organizationId: project.organization_id,
      feature: "checklist_consistency_check",
      promptVersion: PROMPT_VERSIONS.checklist_consistency_check,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let flags: string[];
    if (cached) {
      flags = cached;
    } else {
      const captured = await withGeminiUsage(() =>
        geminiProvider.checkConsistency({
          acceptanceCriteria: itpItem?.acceptance_criteria ?? "",
          responses: responseInputs,
        })
      );
      flags = captured.result;
      usage = captured.usage;
    }
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId: record.project_id,
      userId: user?.id ?? null,
      feature: "checklist_consistency_check",
      modelId: getGeminiModel("checklist_consistency_check"),
      promptVersion: PROMPT_VERSIONS.checklist_consistency_check,
      sourceRef: { templateId, inspectionRecordId },
      aiResponse: flags,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, flags };
  } catch (err) {
    return {
      ...EMPTY_CONSISTENCY_STATE,
      error: err instanceof Error ? err.message : "Could not run the consistency check.",
    };
  }
}

export interface IssueIrnState {
  error: string | null;
}

/**
 * Issues an IRN off a passed inspection record. Numbering is an atomic per-ITP counter (R44-R65).
 * Gated by canExecuteItpItem — same "the party actually assigned to this activity, or staff" rule
 * every other write on this activity already uses. Found missing in a self-review audit: this was
 * the one write action on the checklist path that only checked tenant/project access (via RLS) with
 * no party-level check at all, meaning any project member — including a client or an unrelated
 * subcontractor — could issue a controlled release document off someone else's passed inspection.
 */
export async function issueIrnAction(_prev: IssueIrnState, formData: FormData): Promise<IssueIrnState> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!inspectionRecordId) return { error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, project_id, itp_number, itp_item_id, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "id" | "project_id" | "itp_number" | "itp_item_id" | "overall_result">>();

  if (!record) return { error: "Inspection record not found." };
  if (!(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "Only the party assigned to execute this activity (or JAGS staff) can issue its IRN." };
  }
  if (record.overall_result !== "pass" && record.overall_result !== "partial") {
    return { error: "An IRN can only be issued from a passed (or conditionally passed) inspection." };
  }
  const { count: openNcrCount } = await supabase
    .from("ncrs")
    .select("id", { count: "exact", head: true })
    .eq("inspection_record_id", inspectionRecordId)
    .neq("status", "closed");
  if (openNcrCount) return { error: "An NCR raised from this inspection is still open — close it before issuing the IRN." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string }>();

  // Atomic per-ITP counter (next_document_sequence), same as checklist_number and the INSP suffix
  // above — replaces the earlier count-then-insert, which wasn't collision-proof under concurrent
  // IRN issuance against the same ITP.
  const seq = await nextSequenceNumber(supabase, {
    organizationId: project?.organization_id ?? "",
    projectId: record.project_id,
    seqKey: `irn:${record.itp_number}`,
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from(IRNS_TABLE).insert({
    inspection_record_id: inspectionRecordId,
    irn_number: `${record.itp_number}-IRN-${seq}`,
    issued_by: user?.id ?? null,
  });

  if (error) {
    return { error: error.code === "23505" ? "An IRN already exists for this inspection." : "Could not issue the IRN." };
  }

  if (project?.organization_id) {
    try {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId: record.project_id,
        entityType: "irn",
        entityId: inspectionRecordId,
        action: "issued",
        actorId: user?.id ?? null,
        summary: `IRN ${record.itp_number}-IRN-${seq} issued`,
      });
    } catch {
      // Best-effort — see lib/audit/log.ts's doc comment.
    }
  }

  await notifyAfterIrnIssued(supabase, inspectionRecordId, `${record.itp_number}-IRN-${seq}`);
  revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
  return { error: null };
}

/**
 * Voids (revokes) an issued IRN with a mandatory written reason. JAGS staff only — releasing work
 * is a controlled step, withdrawing the release must be too. The row is kept (flagged) so the
 * numbering and audit trail stay intact; one IRN per inspection record still holds.
 */
export async function voidIrnAction(_prev: IssueIrnState, formData: FormData): Promise<IssueIrnState> {
  const irnId = String(formData.get("irn_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!irnId) return { error: "Missing IRN." };
  if (reason.length < 15) return { error: "Give a reason for voiding the IRN (at least 15 characters)." };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can void an IRN." };

  const supabase = await createSupabaseServerClient();
  const { data: irn } = await supabase
    .from(IRNS_TABLE)
    .select("id, irn_number, inspection_record_id, voided_at")
    .eq("id", irnId)
    .maybeSingle<{ id: string; irn_number: string; inspection_record_id: string; voided_at: string | null }>();
  if (!irn) return { error: "IRN not found." };
  if (irn.voided_at) return { error: "This IRN is already void." };

  const { data: updated, error } = await supabase
    .from(IRNS_TABLE)
    .update({ voided_at: new Date().toISOString(), voided_by: session.userId, void_reason: reason })
    .eq("id", irnId)
    .is("voided_at", null)
    .select("id");
  if (error || !updated?.length) return { error: "Could not void the IRN." };

  try {
    const { data: rec } = await supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("project_id")
      .eq("id", irn.inspection_record_id)
      .maybeSingle<{ project_id: string }>();
    const { data: project } = rec
      ? await supabase.from("projects").select("organization_id").eq("id", rec.project_id).maybeSingle<{ organization_id: string }>()
      : { data: null };
    if (rec && project) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId: rec.project_id,
        entityType: "irn",
        entityId: irn.inspection_record_id,
        action: "voided",
        actorId: session.userId,
        summary: `IRN ${irn.irn_number} voided — ${reason}`,
      });
    }
  } catch {
    // Best-effort audit.
  }

  await notifyAfterIrnVoided(supabase, irn.inspection_record_id, irn.irn_number, reason);
  revalidatePath(`/inspect/inspections/${irn.inspection_record_id}`);
  return { error: null };
}

export interface LinkInspectionEvidenceDocumentState {
  error: string | null;
}

/**
 * Links an existing Document Vault file as this inspection's own evidence — the gap flagged live:
 * photo evidence was device-upload only, with no way to attach a controlled document (a prior
 * cert, a client-supplied drawing) the way itp_item_evidence_documents/
 * standalone_assignment_evidence_documents already let other record types do. Mirrors
 * linkAssignmentEvidenceDocumentAction exactly — upload to the project's Vault first, link here —
 * rather than a second upload path. Optionally scoped to one checklist item (null links it to the
 * whole inspection, same convention inspection_photos.checklist_item_id already uses).
 */
export async function linkInspectionEvidenceDocumentAction(
  _prev: LinkInspectionEvidenceDocumentState,
  formData: FormData
): Promise<LinkInspectionEvidenceDocumentState> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const vaultDocumentIds = [...new Set(formData.getAll("vault_document_id").map((v) => String(v).trim()).filter(Boolean))];
  const checklistItemId = String(formData.get("checklist_item_id") ?? "").trim() || null;
  if (!inspectionRecordId || vaultDocumentIds.length === 0) return { error: "Select at least one file to link." };

  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id, record_number, project_id, checklist_template_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "record_number" | "project_id" | "checklist_template_id">>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can link evidence." };
  }

  {
    const { data: linkDocs } = await supabase
      .from("vault_documents")
      .select("id, status, vault_folders(project_id)")
      .in("id", vaultDocumentIds)
      .returns<{ id: string; status: string; vault_folders: { project_id: string } | null }[]>();
    if ((linkDocs ?? []).length !== vaultDocumentIds.length || (linkDocs ?? []).some((d) => d.vault_folders?.project_id !== record.project_id)) {
      return { error: "One of the selected files isn't in this project's own Document Vault." };
    }
    if ((linkDocs ?? []).some((d) => d.status !== "approved")) {
      return { error: "Only approved files can be linked as evidence — get the others approved in the Document Vault first." };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE).upsert(
    vaultDocumentIds.map((id) => ({
      inspection_record_id: inspectionRecordId,
      checklist_item_id: checklistItemId,
      vault_document_id: id,
      linked_by: user?.id ?? null,
    })),
    { onConflict: "inspection_record_id,vault_document_id", ignoreDuplicates: true }
  );

  if (error) return { error: "Could not link the selected files." };

  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", record.project_id).maybeSingle();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId: record.project_id,
        entityType: "inspection_evidence_document",
        entityId: inspectionRecordId,
        action: "linked",
        actorId: user?.id ?? null,
        summary: `Evidence document linked to inspection ${record.record_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  if (record.checklist_template_id) revalidatePath(`/inspect/checklists/${record.checklist_template_id}`);
  return { error: null };
}

/** Unlink is deliberately void-returning + no client confirmation state, same as every sibling
 *  unlink action (unlinkAssignmentEvidenceDocumentAction) — a plain fire-and-forget form submit. */
export async function unlinkInspectionEvidenceDocumentAction(formData: FormData): Promise<void> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const linkId = String(formData.get("link_id") ?? "").trim();
  if (!inspectionRecordId || !linkId) return;

  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id, record_number, project_id, checklist_template_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "record_number" | "project_id" | "checklist_template_id">>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) return;

  await supabase.from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE).delete().eq("id", linkId);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", record.project_id).maybeSingle();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId: record.project_id,
        entityType: "inspection_evidence_document",
        entityId: inspectionRecordId,
        action: "unlinked",
        actorId: user?.id ?? null,
        summary: `Evidence document unlinked from inspection ${record.record_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  if (record.checklist_template_id) revalidatePath(`/inspect/checklists/${record.checklist_template_id}`);
}

// ---------------------------------------------------------------------------------------------
// Inspection photo actions (save with server-side validation, caption edit, delete)
// ---------------------------------------------------------------------------------------------

export interface PhotoActionResult {
  error: string | null;
}

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

async function loadOpenInspectionForPhoto(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  inspectionRecordId: string
): Promise<{ error: string } | { record: Pick<InspectionRecordRow, "itp_item_id" | "project_id" | "overall_result" | "checklist_template_id"> }> {
  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id, project_id, overall_result, checklist_template_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "project_id" | "overall_result" | "checklist_template_id">>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "You don't have permission to change photos on this inspection." };
  }
  if (record.overall_result) return { error: "This inspection is completed — photos can no longer be changed." };
  return { record };
}

/** Records an already-uploaded photo, validating the storage path and object metadata server-side. */
export async function saveInspectionPhotoAction(input: {
  inspectionRecordId: string;
  storagePath: string;
  checklistItemId?: string;
}): Promise<PhotoActionResult> {
  const supabase = await createSupabaseServerClient();
  const loaded = await loadOpenInspectionForPhoto(supabase, input.inspectionRecordId);
  if ("error" in loaded) return loaded;
  const { record } = loaded;

  const prefix = `${record.project_id}/${input.inspectionRecordId}/`;
  if (!input.storagePath.startsWith(prefix) || input.storagePath.includes("..")) {
    return { error: "That photo's storage path does not belong to this inspection." };
  }
  const folder = input.storagePath.slice(0, input.storagePath.lastIndexOf("/"));
  const fileName = input.storagePath.slice(input.storagePath.lastIndexOf("/") + 1);
  const { data: objs } = await supabase.storage.from("inspection-evidence").list(folder, { search: fileName, limit: 5 });
  const obj = (objs ?? []).find((o) => o.name === fileName);
  if (!obj) return { error: "The uploaded file could not be found in storage." };
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  if (typeof meta.size === "number" && meta.size > MAX_PHOTO_BYTES) {
    await supabase.storage.from("inspection-evidence").remove([input.storagePath]);
    return { error: "Photo is too large (maximum 25 MB)." };
  }
  if (meta.mimetype && !meta.mimetype.startsWith("image/")) {
    await supabase.storage.from("inspection-evidence").remove([input.storagePath]);
    return { error: "Only image files can be attached as photo evidence." };
  }
  if (input.checklistItemId) {
    const { data: item } = await supabase
      .from(CHECKLIST_ITEMS_TABLE)
      .select("id")
      .eq("id", input.checklistItemId)
      .eq("template_id", record.checklist_template_id ?? "")
      .maybeSingle<{ id: string }>();
    if (!item) return { error: "That checklist item was not found." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from(INSPECTION_PHOTOS_TABLE).insert({
    inspection_record_id: input.inspectionRecordId,
    storage_path: input.storagePath,
    uploaded_by: user?.id ?? null,
    checklist_item_id: input.checklistItemId ?? null,
  });
  if (error) return { error: "Could not record the photo." };
  return { error: null };
}

export async function updateInspectionPhotoCaptionAction(photoId: string, caption: string): Promise<PhotoActionResult> {
  const supabase = await createSupabaseServerClient();
  const text = caption.trim();
  if (text.length > 300) return { error: "Caption is too long (maximum 300 characters)." };
  const { data: photo } = await supabase
    .from(INSPECTION_PHOTOS_TABLE)
    .select("id, inspection_record_id")
    .eq("id", photoId)
    .maybeSingle<{ id: string; inspection_record_id: string }>();
  if (!photo) return { error: "Photo not found." };
  const loaded = await loadOpenInspectionForPhoto(supabase, photo.inspection_record_id);
  if ("error" in loaded) return loaded;
  const { error } = await supabase.from(INSPECTION_PHOTOS_TABLE).update({ caption: text || null }).eq("id", photoId);
  if (error) return { error: "Could not save the caption." };
  revalidatePath(`/inspect/inspections/${photo.inspection_record_id}`);
  return { error: null };
}

export async function deleteInspectionPhotoAction(photoId: string): Promise<PhotoActionResult> {
  const supabase = await createSupabaseServerClient();
  const { data: photo } = await supabase
    .from(INSPECTION_PHOTOS_TABLE)
    .select("id, inspection_record_id, storage_path")
    .eq("id", photoId)
    .maybeSingle<{ id: string; inspection_record_id: string; storage_path: string }>();
  if (!photo) return { error: "Photo not found." };
  const loaded = await loadOpenInspectionForPhoto(supabase, photo.inspection_record_id);
  if ("error" in loaded) return loaded;
  const { record } = loaded;

  const { error } = await supabase.from(INSPECTION_PHOTOS_TABLE).delete().eq("id", photoId);
  if (error) return { error: "Could not delete the photo." };
  await supabase.storage.from("inspection-evidence").remove([photo.storage_path]);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: proj } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", record.project_id)
      .maybeSingle<{ organization_id: string }>();
    if (proj?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: proj.organization_id,
        projectId: record.project_id,
        entityType: "inspection_record",
        entityId: photo.inspection_record_id,
        action: "photo_deleted",
        actorId: user?.id ?? null,
        summary: `Evidence photo deleted (${photo.storage_path.split("/").pop()})`,
      });
    }
  } catch {
    // Best-effort audit.
  }
  return { error: null };
}
