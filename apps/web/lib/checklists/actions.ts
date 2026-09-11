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
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage } from "@/lib/ai/log";
import { geminiProvider } from "@/lib/ai/gemini-provider";

export interface GenerateChecklistsState {
  error: string | null;
}

/**
 * R76: self-inspection is the assigned party's own spec'd role, not JAGS staff's alone — a party
 * holding an intervention level (H/W/R/S) on this specific activity is a legitimate stakeholder who
 * can run its checklist, same rule as the checklist page's own isAssignedParty check.
 */
async function canExecuteChecklistForItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<boolean> {
  const session = await requireSession();
  if (session.isJagsStaff) return true;

  const { data: stakeholderParties } = await supabase
    .from("activity_party_intervention")
    .select("project_parties(user_id)")
    .eq("itp_item_id", itpItemId)
    .returns<{ project_parties: { user_id: string | null } | null }[]>();

  return (stakeholderParties ?? []).some((row) => row.project_parties?.user_id === session.userId);
}

/**
 * Generates and numbers a checklist for every evidence_type = 1 activity on an approved ITP that
 * doesn't already have one (R48: checklists are generated at approval, not draft). Deliberately a
 * standalone action rather than a hook into advanceItpStatusAction — approval and "produce the
 * checklists for this approval" stay two separate, auditable steps.
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

  const { data: sections } = await supabase.from("itp_sections").select("id").eq("itp_id", itpId);
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (sectionIds.length === 0) return { error: "This ITP has no sections yet." };

  const { data: items } = await supabase
    .from("itp_items")
    .select("id, activity, reference_spec, acceptance_criteria, method, frequency")
    .in("section_id", sectionIds)
    .eq("evidence_type", 1);

  if (!items || items.length === 0) return { error: "This ITP has no checklist-type activities." };

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

  if (pending.length === 0) return { error: "Checklists already exist for every checklist-type activity." };

  // Real, field-usable checklist items — one AI call per activity, run in parallel. This is
  // gated the same way as every other AI feature (assertAiAllowed) and is best-effort per item:
  // an item the AI can't draft for (unavailable, malformed response) falls back to the single
  // "acceptance criteria as one item" placeholder rather than failing checklist generation
  // outright, so this action never regresses below what it did before AI was wired in.
  const gate = await assertAiAllowed(supabase, itp.projects?.organization_id ?? "");
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

  if (aiUsed && itp.projects?.organization_id) {
    await logAiUsage(supabase, {
      organizationId: itp.projects.organization_id,
      userId: user?.id ?? null,
      feature: "checklist_generation",
    });
  }

  let seq = (existingTemplates ?? []).length + 1;
  const newTemplates = pending.map((item) => ({
    itp_item_id: item.id,
    checklist_number: `${itp.itp_number}-CHK-${seq++}`,
    name: item.activity,
  }));

  const { data: inserted, error: templatesError } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .insert(newTemplates)
    .select("id, itp_item_id")
    .returns<Pick<ChecklistTemplateRow, "id" | "itp_item_id">[]>();

  if (templatesError || !inserted) {
    return { error: "Could not generate checklists. Check you have permission and try again." };
  }

  const pendingById = new Map(pending.map((item) => [item.id, item]));
  const checklistItemsToInsert = inserted.flatMap((t) => {
    const drafted = itemsByPendingId.get(t.itp_item_id);
    if (drafted && drafted.length > 0) {
      return drafted.map((di, i) => ({
        template_id: t.id,
        item_number: String(i + 1),
        description: di.text,
        is_mandatory: di.mandatory,
        sort_order: i,
      }));
    }
    const item = pendingById.get(t.itp_item_id);
    return [
      {
        template_id: t.id,
        item_number: "1",
        description: item?.acceptance_criteria ?? item?.activity ?? "",
        is_mandatory: true,
        sort_order: 0,
      },
    ];
  });

  const { error: itemsError } = await supabase.from(CHECKLIST_ITEMS_TABLE).insert(checklistItemsToInsert);

  if (itemsError) {
    return { error: "Checklists were created, but their items could not be added." };
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

/**
 * One checklist_responses upsert per item — auto-submitted from the field UI as the inspector taps
 * Yes/No/N-A, the same "no separate save step" pattern as setInterventionAction.
 */
export async function saveChecklistResponseAction(formData: FormData) {
  const templateId = String(formData.get("template_id") ?? "").trim();
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const checklistItemId = String(formData.get("checklist_item_id") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim() as ChecklistResponseResult;
  const comment = String(formData.get("comment") ?? "").trim();

  if (!inspectionRecordId || !checklistItemId || !result) return;

  const supabase = await createSupabaseServerClient();

  // Field execution is JAGS staff's job, or (R76) the party assigned to this specific activity
  // self-inspecting — the RLS write policy alone (has_org_access) would let any party with project
  // access answer a checklist item, so the restriction is enforced here too.
  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("itp_item_id")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "itp_item_id">>();
  if (!record || !(await canExecuteChecklistForItem(supabase, record.itp_item_id))) return;

  await supabase.from(CHECKLIST_RESPONSES_TABLE).upsert(
    {
      inspection_record_id: inspectionRecordId,
      checklist_item_id: checklistItemId,
      result,
      comment: comment || null,
    },
    { onConflict: "inspection_record_id,checklist_item_id" }
  );

  revalidatePath(`/inspect/checklists/${templateId}`);
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

  const { count } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("itp_number", itpNumber);

  const { error } = await supabase.from(INSPECTION_RECORDS_TABLE).insert({
    project_id: projectId,
    itp_item_id: itpItemId,
    checklist_template_id: templateId,
    record_number: `${itpNumber}-INSP-${(count ?? 0) + 1}`,
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
export async function completeInspectionAction(
  _prev: CompleteInspectionState,
  formData: FormData
): Promise<CompleteInspectionState> {
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

  const missing = [...itemIds].some((id) => !responseByItem.has(id));
  if (missing) {
    return { error: "Every checklist item needs a Yes / No / N-A response before you can complete the inspection." };
  }

  const results = [...responseByItem.values()];
  const overallResult: OverallResult = results.includes("no") ? "fail" : results.includes("na") ? "partial" : "pass";

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
  }

  redirect(`/inspect/inspections/${inspectionRecordId}`);
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

/** Issues an IRN off a passed inspection record. Numbering is a simple per-ITP counter (R44-R65). */
export async function issueIrnAction(_prev: IssueIrnState, formData: FormData): Promise<IssueIrnState> {
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!inspectionRecordId) return { error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();

  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, itp_number, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<Pick<InspectionRecordRow, "id" | "itp_number" | "overall_result">>();

  if (!record) return { error: "Inspection record not found." };
  if (record.overall_result !== "pass") return { error: "An IRN can only be issued from a passed inspection." };

  // Simple per-ITP counter: count IRNs already issued against inspection records sharing this
  // ITP number. Not collision-proof under concurrent issuance, which is an acceptable trade-off
  // for this phase (see the migration file header).
  const { data: itpRecordIds } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id")
    .eq("itp_number", record.itp_number)
    .returns<Pick<InspectionRecordRow, "id">[]>();

  const { count } = await supabase
    .from(IRNS_TABLE)
    .select("id", { count: "exact", head: true })
    .in("inspection_record_id", (itpRecordIds ?? []).map((r) => r.id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from(IRNS_TABLE).insert({
    inspection_record_id: inspectionRecordId,
    irn_number: `${record.itp_number}-IRN-${(count ?? 0) + 1}`,
    issued_by: user?.id ?? null,
  });

  if (error) {
    return { error: error.code === "23505" ? "An IRN already exists for this inspection." : "Could not issue the IRN." };
  }

  revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
  return { error: null };
}
