"use server";

import { normaliseBulkIds, toBulkItem, type BulkIrnItemResult, type BulkIrnResult } from "./bulk-irn";
import { notifyAfterIrnIssued, notifyAfterIrnVoided } from "./irn-notifications";
import { unnotifiedNonBlockingLevels } from "./notice-waiver";
import { describeSpec, evaluateNumeric, parseNumericInput, validateSpecInput } from "./numeric-response";
import { loadNumericSpec } from "./numeric-spec-query";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { BACKGROUND_JOBS_TABLE } from "@/lib/reports/types";
import { isTeamLeadForProject } from "@/lib/teams/helpers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { evaluateRegisterGate, structuredResponseColumns } from "@/lib/registers/server-check";
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
import { notifyInspectionStarted, notifyInspectionPassed } from "./inspection-notifications";
import { canStartFromTemplate, AI_DRAFT_START_BLOCK_MESSAGE, describeGeneration } from "./ai-review-logic";
import { recordAuditEvent } from "@/lib/audit/log";
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { logAiUsage } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import type { ChecklistItemDraft } from "@/lib/ai/provider";
import { nextSequenceNumber, releaseSequence, NumberingError } from "@/lib/numbering/generate";
import { supersedeIrnVaultDocuments } from "@/lib/vault/irn-void";
import { normaliseLocation, parseCoordinates } from "./location";
import { evaluateGeofence, sanitiseAccuracy, siteGeofenceFromProject } from "./geofence";
import { buildItemsSnapshot } from "./template-logic";
import { bumpTemplateVersion } from "./template-context";
import { getLocationPresetsForProject } from "./location-presets";
import { validateChecklistItemsAnswered, computeOverallResult } from "./completion-logic";
import { boundedCapturedAt } from "@/lib/offline/policy";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { staffVerifierIds } from "@/lib/ncrs/recipients";
import { stripWaiverPrefix, canWaiveEvidence } from "./evidence-waiver";
import {
  validateSignatureDataUrl,
  isCountableEvidenceDoc,
  mandatoryNaWithoutComment,
  itemsMissingEvidence,
  hasMandatoryNa,
  type EvidenceDocLink,
} from "./evidence-rules";

export interface GenerateChecklistsState {
  error: string | null;
  /** Honest outcome message (AI drafts saved / AI failed for N activities). */
  notice?: { tone: "ok" | "warning"; message: string } | null;
  /** True when AI left activities without a checklist, so the UI can offer the blank template explicitly. */
  offerBlank?: boolean;
}

// canExecuteChecklistForItem moved to lib/checklists/execution-parties.ts as the generalized
// canExecuteItpItem — evidence_type=2/3 items (lib/itps/evidence-actions.ts) needed the exact same
// "which party may execute this activity" rule, which doesn't depend on what kind of evidence the
// activity produces. See that file's doc comment for the full R76 rationale (unchanged).

export interface GenerateChecklistsResult {
  error: string | null;
  /** Templates created (AI drafts awaiting confirmation, or blank templates in blank mode). */
  created: number;
  /** AI mode: activities left WITHOUT a checklist because AI was unavailable or returned nothing. */
  failed?: number;
  /** AI mode: why AI was not used, when it was not. */
  reason?: string | null;
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
  params: {
    itpId: string;
    itpNumber: string;
    projectId: string;
    organizationId: string;
    userId: string | null;
    /** "ai" (default): AI-drafted templates saved for staff review; an activity AI cannot draft gets NO
     *  checklist (never a silent placeholder). "blank": the explicit, staff-chosen single-item blank template. */
    mode?: "ai" | "blank";
  }
): Promise<GenerateChecklistsResult> {
  const { itpId, itpNumber, projectId, organizationId, userId } = params;
  const mode = params.mode ?? "ai";

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
  const gate = mode === "blank" ? { allowed: false, reason: null as string | null } : await assertAiAllowed(supabase, organizationId);
  let failureReason: string | null = gate.allowed ? null : gate.reason;
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
        } catch (err) {
          failureReason = aiErrorMessage(err, "the AI service did not return a usable checklist");
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
    ai_generated: boolean;
    items: { item_number: string; description: string; is_mandatory: boolean; sort_order: number }[];
  }[] = [];
  let failed = 0;
  const allocatedChecklistSeqs: number[] = [];

  for (const item of pending) {
    const draftedItems = itemsByPendingId.get(item.id)?.drafted;
    const hasDraft = !!draftedItems && draftedItems.length > 0;
    if (mode === "ai" && !hasDraft) {
      // Honest failure: no placeholder checklist is created behind the user's back.
      failed += 1;
      continue;
    }
    let seq: number;
    try {
      seq = await nextSequenceNumber(supabase, {
        organizationId,
        projectId,
        seqKey: `checklist:${itpId}`,
      });
    } catch (err) {
      if (err instanceof NumberingError) return { error: err.message, created: 0 };
      throw err;
    }
    allocatedChecklistSeqs.push(seq);
    const drafted = itemsByPendingId.get(item.id)?.drafted;
    const items =
      mode === "ai" && drafted && drafted.length > 0
        ? drafted.map((di, i) => ({ item_number: String(i + 1), description: di.text, is_mandatory: di.mandatory, sort_order: i }))
        : [
            {
              item_number: "1",
              description: item.acceptance_criteria ?? item.activity ?? "",
              is_mandatory: true,
              sort_order: 0,
            },
          ];
    payload.push({ itp_item_id: item.id, checklist_number: `${itpNumber}-CHK-${seq}`, name: item.activity, ai_generated: mode === "ai", items });
  }

  if (payload.length === 0) return { error: null, created: 0, failed, reason: failureReason };

  // Single RPC call, one Postgres transaction (insert_checklists_atomic — see its migration for
  // why): every checklist_templates row and every checklist_items row for this run either all land
  // or none do, instead of a failed second insert silently leaving templates with no items behind.
  const { data: inserted, error: insertError } = await supabase.rpc("insert_checklists_atomic", { templates: payload });

  if (insertError || !inserted) {
    // Give the numbers back newest first so the failed run leaves no gap (B3).
    for (const value of [...allocatedChecklistSeqs].reverse()) {
      await releaseSequence(supabase, { organizationId, projectId, seqKey: `checklist:${itpId}`, value });
    }
    return { error: "Could not generate checklists. Check you have permission and try again.", created: 0 };
  }

  // The AI review decision is recorded when staff confirm the draft (confirmAiChecklistAction), not here.
  void aiUsed;

  return { error: null, created: inserted.length, failed, reason: failureReason };
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
  const mode = formData.get("mode") === "blank" ? "blank" : "ai";
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
  if (itp.status !== "approved" && itp.status !== "client_accepted") return { error: "The ITP must be approved before checklists can be generated." };

  const result = await generateChecklistsForItp(supabase, {
    itpId,
    itpNumber: itp.itp_number,
    projectId: itp.project_id,
    organizationId: itp.projects?.organization_id ?? "",
    userId: user?.id ?? null,
    mode,
  });

  if (result.error) return { error: result.error };
  if (result.created === 0 && !result.failed) return { error: "Checklists already exist for every checklist-type activity, or this ITP has none." };
  const notice =
    mode === "blank"
      ? { tone: "ok" as const, message: `${result.created} blank checklist(s) created with a single placeholder item. Edit the items before starting inspections.` }
      : describeGeneration({ drafted: result.created, failed: result.failed ?? 0, reason: result.reason ?? null });

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
  return { error: null, notice, offerBlank: mode === "ai" && (result.failed ?? 0) > 0 };
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
  const isNumeric = formData.get("value_type") === "numeric";

  if (!templateId || !itemNumber || !description) {
    return { error: "Item number and description are required." };
  }
  let numericColumns: Record<string, unknown> = {};
  if (isNumeric) {
    const parsedSpec = validateSpecInput(
      String(formData.get("numeric_min") ?? ""),
      String(formData.get("numeric_max") ?? ""),
      String(formData.get("numeric_unit") ?? "")
    );
    if ("error" in parsedSpec) return { error: parsedSpec.error };
    numericColumns = {
      value_type: "numeric",
      numeric_min: parsedSpec.spec.min,
      numeric_max: parsedSpec.spec.max,
      numeric_unit: parsedSpec.spec.unit,
    };
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
    ...numericColumns,
  });

  if (error) {
    if (isNumeric && isMissingSchemaError(error)) {
      return { error: "Measured items need a database update that has not been applied yet." };
    }
    return { error: error.code === "23505" ? "That item number is already used on this checklist." : "Could not add the item." };
  }
  await bumpTemplateVersion(supabase, templateId);

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
  let result = String(formData.get("result") ?? "").trim() as ChecklistResponseResult;
  const comment = String(formData.get("comment") ?? "").trim();
  const numericRaw = String(formData.get("numeric_value") ?? "").trim();
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

  // S4-20: a measured (numeric) item. The server derives the result from the number and the item's own
  // limits, so a client can't claim "yes" for an out-of-range reading. N/A stays N/A (no value).
  const numericSpec = await loadNumericSpec(supabase, checklistItemId);
  let numericValue: number | null = null;
  if (numericSpec && result !== "na") {
    numericValue = parseNumericInput(numericRaw);
    if (numericValue === null) return { error: "Enter the measured value as a number." };
    result = evaluateNumeric(numericValue, numericSpec);
    if (result === "no" && !comment) {
      return { error: `${numericValue} is outside the limit (${describeSpec(numericSpec)}). A comment is required when an item fails.` };
    }
  }

  // Traceability links must point at a row on THIS project; calibration/welder must also be in date,
  // and material must be released. (Empty = not recorded, always allowed.)
  // The same checks (now judged on the inspection date, with verified/active rows only) plus the
  // register soft-stop recomputed server-side (S3-05/S3-07) live in lib/registers/server-check.ts.
  const {
    data: { user: gateUser },
  } = await supabase.auth.getUser();
  const gate = await evaluateRegisterGate(supabase, {
    projectId: record.project_id,
    itpItemId: record.itp_item_id,
    userId: gateUser?.id ?? null,
    result,
    comment,
    overrideReasonField: String(formData.get("override_reason") ?? ""),
    capturedAtRaw: String(formData.get("captured_at") ?? "") || null,
    calibrationAssetId,
    materialId,
    welderId,
  });
  if (gate.error) return { error: gate.error };

  const payload = {
    ...(await structuredResponseColumns(supabase, gate)),
    inspection_record_id: inspectionRecordId,
    checklist_item_id: checklistItemId,
    result,
    comment: comment || null,
    calibration_asset_id: calibrationAssetId || null,
    material_id: materialId || null,
    welder_id: welderId || null,
    no_ncr_reason: result === "no" ? noNcrReason || null : null,
    ...(numericSpec ? { numeric_value: numericValue } : {}),
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
async function buildGeofenceColumns(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  location: string,
  formData: FormData
): Promise<Record<string, unknown> | null> {
  const coords = parseCoordinates(location);
  const accuracy = coords ? sanitiseAccuracy(formData.get("location_accuracy")) : null;
  const { data: site, error } = await supabase
    .from("projects")
    .select("site_latitude, site_longitude, site_radius_m")
    .eq("id", projectId)
    .maybeSingle<{ site_latitude: number | null; site_longitude: number | null; site_radius_m: number | null }>();
  if (error) return null; // columns not migrated yet
  const check = evaluateGeofence(site ? siteGeofenceFromProject(site) : null, coords, accuracy);
  return {
    location_accuracy_m: accuracy,
    // Server time, not the client's: the reading is taken at the moment of starting.
    location_captured_at: coords ? new Date().toISOString() : null,
    location_distance_m: check.distanceM,
    location_geofence_status: check.status,
  };
}

export async function startInspectionAction(
  _prev: StartInspectionState,
  formData: FormData
): Promise<StartInspectionState> {
  const templateId = String(formData.get("template_id") ?? "").trim();
  const itpItemId = String(formData.get("itp_item_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  // project_name / itp_number / activity are NOT read from the form: they are client-supplied and
  // would be frozen onto a controlled record. They are read from the DB rows below instead.
  const rawLocation = String(formData.get("location") ?? "").trim();

  if (!templateId || !itpItemId || !projectId) {
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
    if (!location) return { error: "A location is required to start the inspection — use live GPS or choose one of the project's locations." };
  }
  if (!(await canExecuteItpItem(supabase, itpItemId))) {
    return { error: "Only JAGS staff or the party assigned to this activity can start a field inspection." };
  }

  // Server-side integrity: the template, activity and project must actually belong together (the
  // hidden form fields are client-supplied), and the ITP must be approved/accepted before work
  // starts — the same gate activity sign-off uses.
  const { data: gate } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id, itp_item_id, itp_items(activity, itp_sections(itps(status, itp_number, projects(id, name))))")
    .eq("id", templateId)
    .maybeSingle<{
      id: string;
      itp_item_id: string | null;
      itp_items: { activity: string; itp_sections: { itps: { status: string; itp_number: string; projects: { id: string; name: string } | null } | null } | null } | null;
    }>();
  if (!gate || gate.itp_item_id !== itpItemId || gate.itp_items?.itp_sections?.itps?.projects?.id !== projectId) {
    return { error: "This checklist does not belong to that activity or project." };
  }
  {
    // AI-generated checklists are drafts until staff confirm them (20261114000102).
    const { data: review, error: reviewError } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("ai_generated, ai_confirmed_at")
      .eq("id", templateId)
      .maybeSingle<{ ai_generated: boolean; ai_confirmed_at: string | null }>();
    if (!reviewError && review && !canStartFromTemplate(review)) return { error: AI_DRAFT_START_BLOCK_MESSAGE };
  }
  const itpNumber = gate.itp_items?.itp_sections?.itps?.itp_number ?? "";
  const activity = gate.itp_items?.activity ?? "";
  const projectName = gate.itp_items?.itp_sections?.itps?.projects?.name ?? "";
  if (!itpNumber || !activity || !projectName) return { error: "Could not read this activity's ITP details. Refresh and try again." };
  const itpStatus = gate.itp_items?.itp_sections?.itps?.status;
  if (itpStatus !== "approved" && itpStatus !== "client_accepted") {
    return { error: "This ITP hasn't been approved yet, so site inspections can't start. Work opens once the ITP is approved." };
  }

  // An activity that already passed and carries a live IRN is released: it is amended by re-opening
  // that inspection (audited, voids the IRN), not by quietly starting a second one beside it.
  {
    const { data: passed } = await supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id, record_number, irns(id, voided_at)")
      .eq("itp_item_id", itpItemId)
      .in("overall_result", ["pass", "partial"])
      .returns<{ id: string; record_number: string; irns: { id: string; voided_at: string | null }[] | null }[]>();
    const released = (passed ?? []).find((r) => (r.irns ?? []).some((i) => !i.voided_at));
    if (released) {
      return { error: `This activity already passed and was released (${released.record_number}). Re-open that inspection to amend it instead of starting a new one.` };
    }
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
  let seq: number;
  try {
    seq = await nextSequenceNumber(supabase, {
      organizationId: project?.organization_id ?? "",
      projectId,
      seqKey: `inspection:${itpNumber}`,
    });
  } catch (err) {
    if (err instanceof NumberingError) return { error: err.message };
    throw err;
  }
  // Hands the number back when the record is not created (B3: a failed save leaves no gap).
  const releaseInspectionNumber = () =>
    releaseSequence(supabase, {
      organizationId: project?.organization_id ?? "",
      projectId,
      seqKey: `inspection:${itpNumber}`,
      value: seq,
    });

  // Per-ACTIVITY attempt count (distinct from the ITP-wide `seq` above) — drives the PDF's Document
  // Control "REV" field. Read-then-insert is fine here (unlike the shared seq counter): a double
  // count on a rare concurrent double-click just produces the same revision number twice, which is
  // cosmetic, not a collision on a unique record_number.
  const { count: priorAttempts } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("itp_item_id", itpItemId);

  // Phase 3 versioning: freeze the template version and its item set onto the record at start.
  // Best-effort: if the template/item read fails or the columns do not exist yet (migration
  // 20261106000100 not applied) the record is created without them, exactly as before.
  let versionColumns: { checklist_template_version: number; checklist_items_snapshot: ReturnType<typeof buildItemsSnapshot> } | null = null;
  {
    const { data: tplVersion, error: tplVersionError } = await supabase
      .from(CHECKLIST_TEMPLATES_TABLE)
      .select("version")
      .eq("id", templateId)
      .maybeSingle<{ version: number }>();
    if (!tplVersionError && tplVersion) {
      const { data: snapItems } = await supabase
        .from(CHECKLIST_ITEMS_TABLE)
        .select("id, item_number, description, is_mandatory, sort_order, acceptance_criteria, evidence_type")
        .eq("template_id", templateId)
        .returns<ChecklistItemRow[]>();
      if (snapItems) versionColumns = { checklist_template_version: tplVersion.version, checklist_items_snapshot: buildItemsSnapshot(snapItems) };
    }
  }

  const recordInsert = {
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
  };
  // S4-17: accuracy / time / soft geofence result. Best-effort: columns exist only after
  // 20261110000200; without them the record is created exactly as before.
  const geoColumns = await buildGeofenceColumns(supabase, projectId, location ?? "", formData);
  const extraColumns = { ...(versionColumns ?? {}), ...(geoColumns ?? {}) };
  let { error } = await supabase.from(INSPECTION_RECORDS_TABLE).insert(Object.keys(extraColumns).length ? { ...recordInsert, ...extraColumns } : recordInsert);
  if (error && geoColumns && isMissingSchemaError(error)) {
    ({ error } = await supabase.from(INSPECTION_RECORDS_TABLE).insert(versionColumns ? { ...recordInsert, ...versionColumns } : recordInsert));
  }
  if (error && versionColumns && isMissingSchemaError(error)) {
    ({ error } = await supabase.from(INSPECTION_RECORDS_TABLE).insert(recordInsert));
  }

  if (error) {
    if (error.code === "23505") {
      // A concurrent start (double click / second device) already opened the draft: resume it.
      const { data: existing } = await supabase
        .from(INSPECTION_RECORDS_TABLE)
        .select("id")
        .eq("itp_item_id", itpItemId)
        .eq("checklist_template_id", templateId)
        .is("overall_result", null)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (existing) {
        await releaseInspectionNumber(); // the concurrent start already holds the draft; ours went unused
        revalidatePath(`/inspect/checklists/${templateId}`);
        return { error: null };
      }
    } else {
      await releaseInspectionNumber();
    }
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

  // Tell the project's responsible person / JAGS staff the work has started (deduped, best-effort).
  {
    const { data: started } = await supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("id, record_number")
      .eq("itp_item_id", itpItemId)
      .eq("checklist_template_id", templateId)
      .is("overall_result", null)
      .limit(1)
      .maybeSingle<{ id: string; record_number: string }>();
    if (started) {
      await notifyInspectionStarted(supabase, {
        organizationId: project?.organization_id,
        projectId,
        recordId: started.id,
        recordNumber: started.record_number,
        activity,
        actorId: user?.id ?? null,
      });
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
  {
    const sigError = validateSignatureDataUrl(signature, "signature");
    if (sigError) return { error: sigError };
    if (witnessSignature) {
      const wErr = validateSignatureDataUrl(witnessSignature, "witness signature");
      if (wErr) return { error: wErr };
    }
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: evidenceUser },
  } = await supabase.auth.getUser();

  // Real gap found live: the "Photo evidence" section looked optional (no enforcement client- or
  // server-side), even though a completed inspection with zero evidence is close to worthless in a
  // dispute or ISO audit. At least one photo OR one linked Vault document — attached to the
  // inspection as a whole, or to any individual item — is now required to complete, mirroring the
  // signature check just above.
  const [{ count: photoCount }, { data: evidenceDocRows }, { data: itemPhotoRows }] = await Promise.all([
    supabase.from(INSPECTION_PHOTOS_TABLE).select("id", { count: "exact", head: true }).eq("inspection_record_id", inspectionRecordId),
    supabase
      .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
      .select("checklist_item_id, vault_documents(status, uploaded_by, vault_folders(folder_key))")
      .eq("inspection_record_id", inspectionRecordId)
      .returns<
        {
          checklist_item_id: string | null;
          vault_documents: { status: string; uploaded_by: string | null; vault_folders: { folder_key: string | null } | null } | null;
        }[]
      >(),
    supabase
      .from(INSPECTION_PHOTOS_TABLE)
      .select("checklist_item_id")
      .eq("inspection_record_id", inspectionRecordId)
      .not("checklist_item_id", "is", null)
      .returns<{ checklist_item_id: string | null }[]>(),
  ]);
  // Only approved vault documents (or the signer's own for-review upload in Checklists & Forms) count; rejected never.
  const countableDocs: EvidenceDocLink[] = (evidenceDocRows ?? [])
    .map((r) => ({
      checklist_item_id: r.checklist_item_id,
      status: r.vault_documents?.status ?? null,
      uploaded_by: r.vault_documents?.uploaded_by ?? null,
      folder_key: r.vault_documents?.vault_folders?.folder_key ?? null,
    }))
    .filter((d) => isCountableEvidenceDoc(d, evidenceUser?.id ?? null));
  const evidenceDocCount = countableDocs.length;
  const evidenceWaived = !photoCount && !evidenceDocCount && noEvidenceReason.length >= MIN_NO_EVIDENCE_REASON_LENGTH;
  // Waiver rules: see canWaiveEvidence (checked below once the answers are known).
  if (!photoCount && !evidenceDocCount && !evidenceWaived) {
    return {
      error: noEvidenceReason
        ? `Explain why no evidence applies (at least ${MIN_NO_EVIDENCE_REASON_LENGTH} characters), or attach a photo or approved document.`
        : "At least one evidence photo or approved linked document is required to complete the inspection.",
    };
  }
  // A re-opened record keeps the previous waiver line in its notes: strip it so it is never duplicated.
  const baseNotes = stripWaiverPrefix(rawNotes);
  const notes = evidenceWaived ? `[No evidence attached — reason: ${noEvidenceReason}]${baseNotes ? `\n${baseNotes}` : ""}` : baseNotes;

  const { data: recordForAuth } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id, checklist_template_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "checklist_template_id">>();
  if (!recordForAuth || !(await canExecuteItpItem(supabase, recordForAuth.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can complete the inspection." };
  }
  // The items to validate come from the record's OWN checklist, never from the posted template id
  // (a crafted or stale request naming a smaller checklist must not be able to skip mandatory items).
  const effectiveTemplateId = recordForAuth.checklist_template_id ?? templateId;

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
    .select("id, item_number, is_mandatory")
    .eq("template_id", effectiveTemplateId)
    .returns<Pick<ChecklistItemRow, "id" | "item_number" | "is_mandatory">[]>();
  const { data: responses } = await supabase
    .from(CHECKLIST_RESPONSES_TABLE)
    .select("checklist_item_id, result, comment")
    .eq("inspection_record_id", inspectionRecordId)
    .returns<Pick<ChecklistResponseRow, "checklist_item_id" | "result" | "comment">[]>();

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

  // Server-side: mandatory N/A needs a >=10 char comment; every "No" and mandatory item needs an item
  // photo/document unless the inspection carries the written no-evidence waiver.
  {
    const naBad = mandatoryNaWithoutComment(items ?? [], responses ?? []);
    if (naBad.length > 0) {
      return { error: `Mandatory item(s) ${naBad.join(", ")} marked N/A need a comment of at least 10 characters.` };
    }
    if (!evidenceWaived) {
      const itemPhotoIds = new Set((itemPhotoRows ?? []).map((r) => r.checklist_item_id).filter((v): v is string => !!v));
      const itemDocIds = new Set(countableDocs.map((d) => d.checklist_item_id).filter((v): v is string => !!v));
      const missing = itemsMissingEvidence(items ?? [], responses ?? [], itemPhotoIds, itemDocIds);
      if (missing.length > 0) {
        return {
          error: `Item(s) ${missing.join(", ")} (a "No" answer or a mandatory item) need a photo or approved document attached to the item, or a written reason for no evidence.`,
        };
      }
    }
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

  // A written no-evidence waiver cannot paper over a failed inspection unless staff sign it.
  if (evidenceWaived && !canWaiveEvidence({ isStaff: (await requireSession()).isJagsStaff, hasNoAnswers: results.includes("no") })) {
    return { error: "A failed inspection needs real photo or document evidence; only JAGS staff can complete it with a written no-evidence reason." };
  }

  // Witness / review points that were never notified cannot be skipped silently: the party must have
  // been notified (or have responded / been proceeded without response) before the work is signed off.
  {
    const unnotified = await unnotifiedNonBlockingLevels(supabase, recordForAuth.itp_item_id, inspectionRecordId);
    if (unnotified.length > 0) {
      return { error: `Notify the ${unnotified.join(", ")} party before completing this inspection (Sign-off tab on the ITP).` };
    }
  }

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
      signed_by_user_id: signer?.id ?? null,
      // A completion replayed from the offline queue carries the time it was really signed.
      signed_at: boundedCapturedAt(String(formData.get("captured_at") ?? "")) ?? new Date().toISOString(),
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
    // Default the punch item's responsible party to the party that performs this activity, so that
    // party can resolve it (only the responsible party or staff can). Left unset if none is found.
    const executingPartyId = await executingPartyIdForItem(supabase, recordForHoldCheck.itp_item_id);
    const failurePunch = await createPunchItemFromSource({
      projectId: recordForHoldCheck.project_id,
      description: `Failed inspection: ${recordForHoldCheck.activity} (${recordForHoldCheck.record_number})`,
      source: "inspection_failure",
      sourceInspectionRecordId: inspectionRecordId,
      responsiblePartyId: executingPartyId ?? undefined,
      priority: "A",
      dedupe: true,
    });
    if (failurePunch.error) {
      // Never silent: the inspection is already locked, so tell the people who must follow it up.
      await notifyPunchFailure(supabase, recordForHoldCheck.project_id, inspectionRecordId, recordForHoldCheck.record_number, recordForHoldCheck.activity);
    }

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

  if (overallResult === "pass" && recordForHoldCheck) {
    await notifyInspectionPassed(supabase, {
      projectId: recordForHoldCheck.project_id,
      recordId: inspectionRecordId,
      recordNumber: recordForHoldCheck.record_number,
      activity: recordForHoldCheck.activity,
      itpItemId: recordForHoldCheck.itp_item_id,
      actorId: signer?.id ?? null,
    });
  }

  // A re-opened inspection that now passes supersedes its earlier failure item: withdraw it so a
  // stale defect never blocks the Data Book. Best-effort (needs verifier/staff rights or the migration).
  if ((overallResult === "pass" || overallResult === "partial") && recordForHoldCheck) {
    try {
      const now = new Date().toISOString();
      const note = `Superseded: inspection ${recordForHoldCheck.record_number} was re-completed as ${overallResult}`;
      const { error: supersedeError } = await supabase
        .from(PUNCH_LIST_ITEMS_TABLE)
        .update({ status: "closed", closing_evidence: note, verification_notes: note, withdrawn_at: now, withdrawn_by: signer?.id ?? null, withdrawn_reason: note, closed_by: signer?.id ?? null, closed_at: now })
        .eq("source_inspection_record_id", inspectionRecordId)
        .eq("source", "inspection_failure")
        .eq("status", "open");
      if (supersedeError && !isMissingSchemaError(supersedeError)) console.error("[punch] supersede failed", supersedeError.message);
    } catch {
      // Best-effort.
    }
  }

  // Auto-generate (and let the worker file) the inspection report so it isn't dependent on someone
  // pressing the button. Best-effort: completion never fails because of it.
  try {
    const { data: inFlight } = await supabase
      .from(BACKGROUND_JOBS_TABLE)
      .select("id")
      .eq("job_type", "render_inspection_report_pdf")
      .eq("payload->>inspection_record_id", inspectionRecordId)
      .in("status", ["pending", "processing"])
      .limit(1);
    if (!inFlight || inFlight.length === 0) {
      await supabase.from(BACKGROUND_JOBS_TABLE).insert({
        job_type: "render_inspection_report_pdf",
        payload: { inspection_record_id: inspectionRecordId, requested_by: signer?.id ?? null },
      });
    }
  } catch {
    // Best-effort.
  }

  return { error: null, inspectionRecordId };
}

async function notifyPunchFailure(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  recordId: string,
  recordNumber: string,
  activity: string
) {
  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
    if (!project) return;
    const recipients = await staffVerifierIds(supabase);
    for (const recipientUserId of recipients) {
      await createNotification(supabase, {
        organizationId: project.organization_id,
        projectId,
        recipientUserId,
        title: "Failed inspection has no punch item",
        body: `${recordNumber} (${activity}) failed but its punch-list item could not be created. Add it manually.`,
        link: `/inspect/inspections/${recordId}`,
      });
    }
  } catch {
    // Best-effort.
  }
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
      error: aiErrorMessage(err, "Could not run the consistency check."),
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
  const out = await issueIrnForRecord(supabase, inspectionRecordId);
  return { error: out.error };
}

/** Outcome of one issue attempt. `already` = a live IRN existed, nothing was issued (not an error). */
interface IssueIrnOutcome {
  error: string | null;
  irnNumber?: string;
  already?: boolean;
}

/**
 * The single issue path shared by issueIrnAction and bulkIssueIrnAction: every gate (party check, result,
 * Hold, mandatory N/A, open NCRs, live-IRN idempotence, the issue_irn RPC's own DB gates) runs per record.
 */
async function issueIrnForRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  inspectionRecordId: string
): Promise<IssueIrnOutcome> {
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
  if (!(await canCompleteInspection(record.itp_item_id))) {
    return { error: "This activity has an open Hold — it must be signed off before an IRN can be issued." };
  }
  if (record.overall_result === "partial") {
    const { data: tplRow } = await supabase
      .from(INSPECTION_RECORDS_TABLE)
      .select("checklist_template_id")
      .eq("id", inspectionRecordId)
      .maybeSingle<{ checklist_template_id: string | null }>();
    if (tplRow?.checklist_template_id) {
      const [{ data: its }, { data: resp }] = await Promise.all([
        supabase.from(CHECKLIST_ITEMS_TABLE).select("id, item_number, is_mandatory").eq("template_id", tplRow.checklist_template_id).returns<Pick<ChecklistItemRow, "id" | "item_number" | "is_mandatory">[]>(),
        supabase.from(CHECKLIST_RESPONSES_TABLE).select("checklist_item_id, result, comment").eq("inspection_record_id", inspectionRecordId).returns<Pick<ChecklistResponseRow, "checklist_item_id" | "result" | "comment">[]>(),
      ]);
      if (hasMandatoryNa(its ?? [], resp ?? [])) {
        return { error: "An IRN can't be issued while a mandatory checklist item is marked N/A." };
      }
    }
  }
  const { count: openNcrCount } = await supabase
    .from("ncrs")
    .select("id", { count: "exact", head: true })
    .eq("inspection_record_id", inspectionRecordId)
    .neq("severity", "observation") // observations never block an IRN; only real NCRs do
    .neq("status", "closed");
  if (openNcrCount) return { error: "An NCR raised from this inspection is still open — close it before issuing the IRN." };

  // One LIVE IRN per inspection record. Only a live IRN counts: a voided one (void / re-open) must be
  // replaceable, otherwise the replacement can never be issued and the Data Book gate stays below 100%.
  const { data: existingIrn } = await supabase
    .from(IRNS_TABLE)
    .select("id")
    .eq("inspection_record_id", inspectionRecordId)
    .is("voided_at", null)
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (existingIrn) return { error: null, already: true };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string }>();
  if (!project?.organization_id) return { error: "Could not resolve the project's organisation, so no IRN number was allocated." };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Preferred: one transaction allocates the number AND inserts the IRN, so a failed insert or a lost race
  // burns no number in the controlled series (issue_irn RPC). Falls back to the two-step path below until
  // that migration is applied.
  let irnNumber: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated Database type yet
  const rpc = await (supabase.rpc as any)("issue_irn", { p_inspection_record_id: inspectionRecordId });
  if (!rpc.error) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    if (!row) return { error: "Could not issue the IRN." };
    if (row.out_already) {
      revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
      return { error: null, already: true };
    }
    irnNumber = String(row.out_number);
  } else if (!(rpc.error.code === "42883" || rpc.error.code === "PGRST202" || /could not find the function/i.test(rpc.error.message ?? ""))) {
    if (rpc.error.code === "42501") return { error: "You are not allowed to issue an IRN for this inspection." };
    console.error("[irn] issue_irn failed", rpc.error.message);
    return { error: "Could not issue the IRN." };
  }

  if (irnNumber === null) {
    // Atomic per-ITP counter (next_document_sequence). Fails CLOSED: an IRN is a controlled release
    // document, so there is deliberately no Date.now() fallback number.
    const { data: seqData, error: seqError } = await supabase.rpc("next_document_sequence", {
      org_id: project.organization_id,
      proj_id: record.project_id,
      seq_doc_type: `irn:${record.itp_number}`,
    });
    if (seqError || typeof seqData !== "number") {
      console.error("[irn] next_document_sequence failed", seqError?.message ?? seqData);
      return { error: "Could not allocate an IRN number. Please try again." };
    }
    irnNumber = `${record.itp_number}-IRN-${seqData}`;
    const { error } = await supabase.from(IRNS_TABLE).insert({
      inspection_record_id: inspectionRecordId,
      irn_number: irnNumber,
      issued_by: user?.id ?? null,
    });
    if (error) {
      // A failed save must not leave a gap in the IRN numbering (B3). A 23505 other than a concurrent
      // issue (below) means the number itself is already in use, so it is only handed back for other errors.
      const releaseIrnNumber = () =>
        releaseSequence(supabase, {
          organizationId: project.organization_id,
          projectId: record.project_id,
          seqKey: `irn:${record.itp_number}`,
          value: seqData,
        });
      if (error.code !== "23505") await releaseIrnNumber();
      if (error.code === "23505") {
        // Concurrent issue: the other request won - return the existing live IRN rather than failing.
        const { data: winner } = await supabase
          .from(IRNS_TABLE)
          .select("id")
          .eq("inspection_record_id", inspectionRecordId)
          .is("voided_at", null)
          .limit(1)
          .maybeSingle<{ id: string }>();
        if (winner) {
          await releaseIrnNumber(); // our number went unused: the concurrent request issued the IRN
          revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
          return { error: null, already: true };
        }
        return { error: "An IRN already exists for this inspection." };
      }
      return { error: "Could not issue the IRN." };
    }
  }

  try {
    await recordAuditEvent(supabase, {
      organizationId: project.organization_id,
      projectId: record.project_id,
      entityType: "irn",
      entityId: inspectionRecordId,
      action: "issued",
      actorId: user?.id ?? null,
      summary: `IRN ${irnNumber} issued`,
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  await notifyAfterIrnIssued(supabase, inspectionRecordId, irnNumber);
  revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
  return { error: null, irnNumber };
}

/**
 * Bulk issue: loops the exact single-issue path above (no gate is bypassed or re-implemented), one record
 * at a time so the per-ITP numbering stays strictly sequential, and keeps going past per-item failures.
 */
export async function bulkIssueIrnAction(ids: string[]): Promise<BulkIrnResult> {
  const { ids: clean, error } = normaliseBulkIds(ids);
  if (error) return { error, items: [] };
  const supabase = await createSupabaseServerClient();
  const items: BulkIrnItemResult[] = [];
  for (const id of clean) {
    try {
      const out = await issueIrnForRecord(supabase, id);
      items.push(toBulkItem(id, out));
    } catch (err) {
      console.error("[irn] bulk issue threw", err);
      items.push({ id, status: "skipped", reason: "Could not issue the IRN." });
    }
  }
  revalidatePath("/inspect/inspections");
  return { error: null, items };
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

  // Same authority as re-opening an inspection (admin or a team lead on the project): an inspector must not
  // be able to leave a signed, passed record with no IRN that only an admin can then repair.
  const { data: voidRec } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("project_id")
    .eq("id", irn.inspection_record_id)
    .maybeSingle<{ project_id: string }>();
  if (!isAdminStaff(session) && !(voidRec && (await isTeamLeadForProject(supabase, session.userId, voidRec.project_id)))) {
    return { error: "Only an admin or a team lead on this project can void an IRN." };
  }

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
    if (rec) await supersedeIrnVaultDocuments(supabase, rec.project_id, irn.irn_number);
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

  // Stamp the already-issued PDF as VOID: queue the VOID copy (the worker renders voided IRNs with the banner).
  try {
    await supabase.from(BACKGROUND_JOBS_TABLE).insert({ job_type: "render_irn_pdf", payload: { irn_id: irnId, requested_by: session.userId } });
  } catch {
    // Best-effort; staff can still generate it from the IRN page.
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
    .select("itp_item_id, record_number, project_id, checklist_template_id, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "record_number" | "project_id" | "checklist_template_id" | "overall_result">>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) {
    return { error: "Only JAGS staff or the party assigned to this activity can link evidence." };
  }
  if (record.overall_result) {
    return { error: "This inspection is completed; evidence can't be changed — ask staff to re-open it." };
  }

  {
    const { data: linkDocs } = await supabase
      .from("vault_documents")
      .select("id, status, uploaded_by, vault_folders(project_id, folder_key)")
      .in("id", vaultDocumentIds)
      .returns<{ id: string; status: string; uploaded_by: string | null; vault_folders: { project_id: string; folder_key: string | null } | null }[]>();
    if ((linkDocs ?? []).length !== vaultDocumentIds.length || (linkDocs ?? []).some((d) => d.vault_folders?.project_id !== record.project_id)) {
      return { error: "One of the selected files isn't in this project's own Document Vault." };
    }
    // Per-item exception (same rule as uploadItemDocumentAction): the executing party's OWN just-uploaded
    // "for review" file in Checklists & Forms may be linked to a checklist item before it is approved.
    const {
      data: { user: linkUser },
    } = await supabase.auth.getUser();
    const pendingOk = (d: { status: string; uploaded_by: string | null; vault_folders: { folder_key: string | null } | null }) =>
      !!checklistItemId &&
      d.status === "for_review" &&
      !!linkUser &&
      d.uploaded_by === linkUser.id &&
      d.vault_folders?.folder_key === "checklists_forms";
    if ((linkDocs ?? []).some((d) => d.status !== "approved" && !pendingOk(d))) {
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
    .select("itp_item_id, record_number, project_id, checklist_template_id, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id" | "record_number" | "project_id" | "checklist_template_id" | "overall_result">>();
  if (!record || !(await canExecuteItpItem(supabase, record.itp_item_id))) return;
  if (record.overall_result) return; // completed inspection: evidence is frozen

  await supabase
    .from(INSPECTION_EVIDENCE_DOCUMENTS_TABLE)
    .delete()
    .eq("id", linkId)
    .eq("inspection_record_id", inspectionRecordId);

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

/**
 * The active subcontractor (else main contractor) party holding an intervention point on this ITP
 * item — i.e. whoever performs the work. Null when the item has no such party; callers then leave the
 * responsible party unset (staff-only to resolve) rather than guessing.
 */
async function executingPartyIdForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string | null
): Promise<string | null> {
  if (!itpItemId) return null;
  try {
    const { data: progress } = await supabase
      .from("activity_signoff_progress")
      .select("project_party_id")
      .eq("itp_item_id", itpItemId)
      .returns<{ project_party_id: string }[]>();
    const ids = [...new Set((progress ?? []).map((p) => p.project_party_id))];
    if (ids.length === 0) return null;
    const { data: parties } = await supabase
      .from("project_parties")
      .select("id, party_type")
      .in("id", ids)
      .eq("is_active", true)
      .in("party_type", ["subcontractor", "main_contractor"])
      .returns<{ id: string; party_type: string }[]>();
    return (parties ?? []).find((p) => p.party_type === "subcontractor")?.id ?? (parties ?? [])[0]?.id ?? null;
  } catch {
    return null;
  }
}
