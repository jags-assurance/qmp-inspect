"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CHECKLIST_ITEMS_TABLE,
  CHECKLIST_RESPONSES_TABLE,
  CHECKLIST_TEMPLATES_TABLE,
  INSPECTION_RECORDS_TABLE,
  IRNS_TABLE,
  type ChecklistItemRow,
  type ChecklistResponseResult,
  type ChecklistResponseRow,
  type ChecklistTemplateRow,
  type InspectionRecordRow,
  type OverallResult,
} from "./db-types";
import { requireSession } from "@/lib/auth/session";
import { canCompleteInspection } from "@/lib/signoff/actions";
import { getExecutingPartyTypes, findProjectIdForItpItem } from "./execution-parties";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { createNotification } from "@/lib/notifications/helpers";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS } from "@/lib/ai/gemini-provider";
import { nextSequenceNumber } from "@/lib/numbering/generate";
import { validateChecklistItemsAnswered, computeOverallResult } from "./completion-logic";

export interface GenerateChecklistsState {
  error: string | null;
}

/**
 * R76: self-inspection is the assigned party's own spec'd role, not JAGS staff's alone — a party
 * holding an intervention level (H/W/R/S) on this specific activity is a legitimate stakeholder, but
 * only one whose party_type is actually an executing type (subcontractor/main_contractor, plus
 * client when the project has opted into projects.allow_client_execution — see
 * lib/checklists/execution-parties.ts) may run its checklist; an independent verifier (TPI/lab) or
 * a client without that opt-in still can't, same rule as the checklist page's own isAssignedParty
 * check (apps/web/app/inspect/checklists/[templateId]/page.tsx), kept in sync via the shared helper.
 *
 * project_parties.is_active is checked here too: until now it was only a display filter on list
 * pages ("Deactivate all parties" etc. hid a party from the UI but never actually revoked anything),
 * so a deactivated party's linked user could still tap Yes/No/N-A on a live checklist. Requiring
 * is_active here makes deactivation a real access boundary rather than cosmetic.
 */
async function canExecuteChecklistForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<boolean> {
  const session = await requireSession();
  if (session.isJagsStaff) return true;

  const { data: stakeholderParties } = await supabase
    .from("activity_party_intervention")
    .select("project_parties(user_id, party_type, is_active)")
    .eq("itp_item_id", itpItemId)
    .returns<{ project_parties: { user_id: string | null; party_type: string; is_active: boolean } | null }[]>();

  const projectId = await findProjectIdForItpItem(supabase, itpItemId);
  const executingPartyTypes = projectId
    ? await getExecutingPartyTypes(supabase, projectId)
    : new Set<string>();

  return (stakeholderParties ?? []).some(
    (row) =>
      row.project_parties?.user_id === session.userId &&
      row.project_parties.is_active &&
      executingPartyTypes.has(row.project_parties.party_type)
  );
}

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
  let aiUsed = false;
  const itemsByPendingId = new Map(
    await Promise.all(
      pending.map(async (item) => {
        if (!gate.allowed) return [item.id, null] as const;
        try {
          const drafted = await geminiProvider.generateChecklistItems({
            activity: item.activity,
            referenceSpec: item.reference_spec ?? "",
            acceptanceCriteria: item.acceptance_criteria ?? "",
            method: item.method ?? "",
            frequency: item.frequency ?? "",
            sourceExcerpt: "",
          });
          aiUsed = true;
          return [item.id, drafted] as const;
        } catch {
          return [item.id, null] as const;
        }
      })
    )
  );

  let aiLogId: string | null = null;
  if (aiUsed && organizationId) {
    aiLogId = await logAiUsage(supabase, {
      organizationId,
      userId,
      feature: "checklist_generation",
      modelId: getGeminiModel("checklist_generation"),
      promptVersion: PROMPT_VERSIONS.checklist_generation,
      sourceRef: { itpId, itemIds: pending.map((i) => i.id) },
      aiResponse: Object.fromEntries(itemsByPendingId),
    });
  }

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
    const drafted = itemsByPendingId.get(item.id);
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

  if (aiLogId && userId) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: userId,
      targetType: "checklist_batch",
      targetId: itpId,
      reviewedResponse: { insertedTemplateIds: inserted.map((t) => t.id) },
      decision: "accepted_as_is", // generated and persisted in one atomic step, no separate human-edit screen exists for this feature today
    });
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

  const supabase = await createSupabaseServerClient();

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

  revalidatePath(`/inspect/checklists/${templateId}`);
  return { error: null };
}

export interface SaveChecklistResponseResult {
  error: string | null;
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

  if (!inspectionRecordId || !checklistItemId || !result) {
    return { error: "Missing required fields — could not save your response." };
  }

  const supabase = await createSupabaseServerClient();

  // Field execution is JAGS staff's job, or (R76) the party assigned to this specific activity
  // self-inspecting — the RLS write policy alone (has_org_access) would let any party with project
  // access answer a checklist item, so the restriction is enforced here too.
  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id">>();
  if (!record || !(await canExecuteChecklistForItem(supabase, record.itp_item_id))) {
    return { error: "Could not save — you don't have permission to record a response for this activity." };
  }

  const { error } = await supabase.from(CHECKLIST_RESPONSES_TABLE).upsert(
    {
      inspection_record_id: inspectionRecordId,
      checklist_item_id: checklistItemId,
      result,
      comment: comment || null,
      calibration_asset_id: calibrationAssetId || null,
    },
    { onConflict: "inspection_record_id,checklist_item_id" }
  );

  if (error) {
    return { error: "Could not save your response. Check your connection and try again." };
  }

  // Deliberately no revalidatePath here: ResponseRow already reflects the save optimistically via
  // its own local state, so a full-page RSC refetch on every single field blur bought nothing but
  // latency — with several sequential queries on this route (register verification, past records,
  // etc.), it made useTransition's isPending (the "Saving…" label) stay true for seconds after the
  // actual write had long since completed, reading as stuck to a real user. Other viewers still pick
  // up the change via the page's own RealtimeRefresh subscription on checklist_responses.
  return { error: null };
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
  const location = String(formData.get("location") ?? "").trim();

  if (!templateId || !itpItemId || !projectId || !projectName || !itpNumber || !activity) {
    return { error: "Missing required fields to start the inspection." };
  }

  const supabase = await createSupabaseServerClient();
  if (!(await canExecuteChecklistForItem(supabase, itpItemId))) {
    return { error: "Only JAGS staff or the party assigned to this activity can start a field inspection." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  // Atomic per-ITP counter, same reasoning as checklist_number above — a plain count-then-insert
  // would let two inspectors starting a field inspection at the same moment collide on the same
  // INSP suffix.
  const seq = await nextSequenceNumber(supabase, {
    organizationId: project?.organization_id ?? "",
    projectId,
    seqKey: `inspection:${itpNumber}`,
  });

  const { error } = await supabase.from(INSPECTION_RECORDS_TABLE).insert({
    project_id: projectId,
    itp_item_id: itpItemId,
    checklist_template_id: templateId,
    record_number: `${itpNumber}-INSP-${seq}`,
    project_name: projectName,
    itp_number: itpNumber,
    activity,
    location: location || null,
    inspector_id: user?.id ?? null,
  });

  if (error) {
    return { error: "Could not start the inspection. Check you have permission and try again." };
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
 * a non-null overall_result. A fail/partial result is a normal, expected outcome here — raising an
 * NCR off it is a separate feature (a different agent's work); this only surfaces that possibility
 * to the inspector, it doesn't call anything for it.
 */
/**
 * The validation + write logic shared by completeInspectionAction (the live form, which redirects
 * on success) and the offline-sync route handler (POST /api/offline-sync, which never redirects —
 * it's a background fetch, not a page navigation). Pulled out so both places enforce exactly the
 * same rules (Hold gating, every item answered) instead of the sync path re-implementing — and
 * potentially drifting from — the real one.
 */
export async function completeInspectionCore(formData: FormData): Promise<CompleteInspectionState & { inspectionRecordId?: string }> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const templateId = String(formData.get("template_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const signature = String(formData.get("signature") ?? "").trim();

  if (!inspectionRecordId || !templateId) return { error: "Missing inspection record." };
  if (!signature) return { error: "A signature is required to complete the inspection." };

  const supabase = await createSupabaseServerClient();

  const { data: recordForAuth } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id">>();
  if (!recordForAuth || !(await canExecuteChecklistForItem(supabase, recordForAuth.itp_item_id))) {
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

  const results = [...responseByItem.values()];
  const overallResult: OverallResult = computeOverallResult(results);

  const { error } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .update({
      overall_result: overallResult,
      notes: notes || null,
      inspector_signature: signature || null,
    })
    .eq("id", inspectionRecordId);

  if (error) {
    return { error: "Could not complete the inspection. Check you have permission and try again." };
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

      if (itp?.prepared_by && organizationId) {
        await createNotification(supabase, {
          organizationId,
          projectId: recordForHoldCheck.project_id,
          recipientUserId: itp.prepared_by,
          title: "Inspection failed",
          body: `${recordForHoldCheck.activity} (${recordForHoldCheck.record_number})`,
          link: `/inspect/inspections/${inspectionRecordId}`,
        });
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
    const flags = await geminiProvider.checkConsistency({
      acceptanceCriteria: itpItem?.acceptance_criteria ?? "",
      responses: responseInputs,
    });
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      userId: user?.id ?? null,
      feature: "checklist_consistency_check",
      modelId: getGeminiModel("checklist_consistency_check"),
      promptVersion: PROMPT_VERSIONS.checklist_consistency_check,
      sourceRef: { templateId, inspectionRecordId },
      aiResponse: flags,
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

/** Issues an IRN off a passed inspection record. Numbering is an atomic per-ITP counter (R44-R65). */
export async function issueIrnAction(_prev: IssueIrnState, formData: FormData): Promise<IssueIrnState> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!inspectionRecordId) return { error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, project_id, itp_number, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "id" | "project_id" | "itp_number" | "overall_result">>();

  if (!record) return { error: "Inspection record not found." };
  if (record.overall_result !== "pass") return { error: "An IRN can only be issued from a passed inspection." };

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

  revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
  return { error: null };
}
