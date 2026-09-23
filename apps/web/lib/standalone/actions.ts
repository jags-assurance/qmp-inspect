"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { nextSequenceNumber } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS } from "@/lib/ai/gemini-provider";
import type { StandaloneMeasurementSuggestion } from "@/lib/ai/provider";
import {
  STANDALONE_ASSIGNMENTS,
  STANDALONE_ASSIGNMENT_MEASUREMENTS,
  STANDALONE_ASSIGNMENT_PHOTOS,
  STANDALONE_ASSIGNMENT_PUNCH_ITEMS,
  STANDALONE_ASSIGNMENT_SIGNATURES,
} from "./types";

const STAFF_ONLY_ERROR = "Only JAGS staff can run a standalone assignment.";

export type AssignmentType = "fat" | "witness_inspection" | "specific_test" | "pre_shipment";
// R16: a conditional pass leaves the assignment genuinely open ("conditional_open") until its
// linked punch item(s) are closed and a clearance is issued — only then does it become "completed",
// same as a clean pass/fail does immediately on finalize.
export type AssignmentStatus = "draft" | "conditional_open" | "completed";
export type AssignmentConclusion = "pass" | "conditional_pass" | "fail";
export type MeasurementResult = "pass" | "fail";
export type PunchItemStatus = "open" | "closed";

export interface StandaloneAssignmentRow {
  id: string;
  project_id: string;
  assignment_number: string;
  assignment_type: AssignmentType;
  equipment_description: string;
  manufacturer: string | null;
  model: string | null;
  serial_tag: string | null;
  location: string | null;
  standard_reference: string | null;
  assignment_date: string | null;
  discipline_id: string | null;
  status: AssignmentStatus;
  conclusion: AssignmentConclusion | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StandaloneAssignmentMeasurementRow {
  id: string;
  assignment_id: string;
  description: string;
  nominal_value: string | null;
  tolerance: string | null;
  actual_value: string | null;
  unit: string | null;
  result: MeasurementResult | null;
  sort_order: number;
  created_at: string;
}

export interface StandaloneAssignmentPhotoRow {
  id: string;
  assignment_id: string;
  storage_path: string;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface StandaloneAssignmentPunchItemRow {
  id: string;
  assignment_id: string;
  description: string;
  status: PunchItemStatus;
  created_at: string;
}

export interface StandaloneAssignmentSignatureRow {
  id: string;
  assignment_id: string;
  role: string;
  signatory_name: string;
  signature_data: string;
  signed_at: string;
}

const ASSIGNMENT_TYPE_PREFIX: Record<AssignmentType, string> = {
  fat: "FAT",
  witness_inspection: "WI",
  specific_test: "ST",
  pre_shipment: "PS",
};

const ASSIGNMENT_TYPES: AssignmentType[] = ["fat", "witness_inspection", "specific_test", "pre_shipment"];

export interface CreateAssignmentState {
  error: string | null;
}

export async function createAssignmentAction(
  _prev: CreateAssignmentState,
  formData: FormData
): Promise<CreateAssignmentState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const projectId = String(formData.get("project_id") ?? "").trim();
  const assignmentType = String(formData.get("assignment_type") ?? "").trim() as AssignmentType;
  const equipmentDescription = String(formData.get("equipment_description") ?? "").trim();
  const manufacturer = String(formData.get("manufacturer") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const serialTag = String(formData.get("serial_tag") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const standardReference = String(formData.get("standard_reference") ?? "").trim();
  const assignmentDate = String(formData.get("assignment_date") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();

  if (!projectId || !ASSIGNMENT_TYPES.includes(assignmentType) || !equipmentDescription) {
    return { error: "Project, assignment type and equipment description are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found." };
  }

  // Atomic per-project-per-type counter (next_document_sequence) — a plain count-then-insert would
  // let two assignments of the same type created at the same moment collide on the same number,
  // which is exactly the race the 23505 handling below used to paper over rather than prevent.
  const rawSeq = await nextSequenceNumber(supabase, {
    organizationId: project.organization_id,
    projectId,
    seqKey: `standalone_assignment:${assignmentType}`,
  });
  const seq = String(rawSeq).padStart(3, "0");
  const assignmentNumber = `${project.project_number}-${ASSIGNMENT_TYPE_PREFIX[assignmentType]}-${seq}`;

  const { data: assignment, error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .insert({
      project_id: projectId,
      assignment_number: assignmentNumber,
      assignment_type: assignmentType,
      equipment_description: equipmentDescription,
      manufacturer: manufacturer || null,
      model: model || null,
      serial_tag: serialTag || null,
      location: location || null,
      standard_reference: standardReference || null,
      assignment_date: assignmentDate || null,
      discipline_id: disciplineId || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !assignment) {
    if (error?.code === "23505") {
      return { error: "That assignment number was just taken — please try again." };
    }
    return { error: "Could not create the assignment. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "standalone_assignment",
    entityId: assignment.id,
    action: "created",
    actorId: user?.id ?? null,
    summary: `Standalone assignment ${assignmentNumber} created`,
  });

  redirect(`/inspect/standalone/${assignment.id}`);
}

export interface AddMeasurementState {
  error: string | null;
}

export async function addMeasurementAction(
  _prev: AddMeasurementState,
  formData: FormData
): Promise<AddMeasurementState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nominalValue = String(formData.get("nominal_value") ?? "").trim();
  const tolerance = String(formData.get("tolerance") ?? "").trim();
  const actualValue = String(formData.get("actual_value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const result = String(formData.get("result") ?? "").trim();

  if (!assignmentId || !description) {
    return { error: "Description is required." };
  }

  const supabase = await createSupabaseServerClient();

  const { count } = await supabase
    .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_MEASUREMENTS).insert({
    assignment_id: assignmentId,
    description,
    nominal_value: nominalValue || null,
    tolerance: tolerance || null,
    actual_value: actualValue || null,
    unit: unit || null,
    result: result === "pass" || result === "fail" ? result : null,
    sort_order: count ?? 0,
  });

  if (error) {
    return { error: "Could not add the measurement. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface SuggestMeasurementsState {
  error: string | null;
  suggestions: StandaloneMeasurementSuggestion[] | null;
}

const EMPTY_SUGGEST_MEASUREMENTS_STATE: SuggestMeasurementsState = { error: null, suggestions: null };

/**
 * Purely advisory: drafts a handful of equipment-specific measurement/test-parameter suggestions
 * for the inspector to review, one at a time, via their own "+ Add" (addMeasurementAction) —
 * mirrors the "AI drafts, human decides" rule used everywhere else in the app (e.g.
 * checkChecklistConsistencyAction, draftFatNarrativeAction). Never writes a measurement itself.
 */
export async function suggestStandaloneMeasurementsAction(
  _prev: SuggestMeasurementsState,
  formData: FormData
): Promise<SuggestMeasurementsState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: assignment } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("assignment_type, equipment_description, manufacturer, model, standard_reference, project_id")
    .eq("id", assignmentId)
    .maybeSingle<
      Pick<
        StandaloneAssignmentRow,
        "assignment_type" | "equipment_description" | "manufacturer" | "model" | "standard_reference" | "project_id"
      >
    >();

  if (!assignment) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: "Assignment not found." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", assignment.project_id)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: gate.reason };

  try {
    // Grounded only in the equipment's own static fields (type/description/manufacturer/model/
    // standard) — the same piece of equipment on a different assignment hashes identically, so this
    // is a strong repeat-input candidate (a manufacturer/model combo showing up on more than one
    // FAT).
    const cacheInput = {
      assignmentType: assignment.assignment_type,
      equipmentDescription: assignment.equipment_description,
      manufacturer: assignment.manufacturer,
      model: assignment.model,
      standardReference: assignment.standard_reference,
    };
    const inputHash = hashAiCacheInput(cacheInput);
    const cached = await findCachedAiResponse<StandaloneMeasurementSuggestion[]>(supabase, {
      organizationId: project.organization_id,
      feature: "standalone_measurement_suggestion",
      promptVersion: PROMPT_VERSIONS.standalone_measurement_suggestion,
      inputHash,
    });
    const suggestions = cached ?? (await geminiProvider.suggestStandaloneMeasurements(cacheInput));
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      userId: user?.id ?? null,
      feature: "standalone_measurement_suggestion",
      modelId: getGeminiModel("standalone_measurement_suggestion"),
      promptVersion: PROMPT_VERSIONS.standalone_measurement_suggestion,
      sourceRef: { assignmentId, assignmentType: assignment.assignment_type },
      aiResponse: suggestions,
      inputHash,
      servedFromCache: !!cached,
    });
    return { error: null, suggestions };
  } catch (err) {
    return {
      ...EMPTY_SUGGEST_MEASUREMENTS_STATE,
      error: err instanceof Error ? err.message : "Could not generate measurement suggestions.",
    };
  }
}

export interface AddPunchItemState {
  error: string | null;
}

export async function addPunchItemAction(
  _prev: AddPunchItemState,
  formData: FormData
): Promise<AddPunchItemState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!assignmentId || !description) {
    return { error: "Description is required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_PUNCH_ITEMS).insert({
    assignment_id: assignmentId,
    description,
  });

  if (error) {
    return { error: "Could not add the punch item. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export async function togglePunchItemAction(formData: FormData) {
  const session = await requireSession();
  if (!session.isJagsStaff) return;

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const currentStatus = String(formData.get("current_status") ?? "").trim() as PunchItemStatus;
  const nextStatus: PunchItemStatus = currentStatus === "open" ? "closed" : "open";

  if (!assignmentId || !punchItemId) return;

  const supabase = await createSupabaseServerClient();
  await supabase
    .from(STANDALONE_ASSIGNMENT_PUNCH_ITEMS)
    .update({ status: nextStatus })
    .eq("id", punchItemId);

  revalidatePath(`/inspect/standalone/${assignmentId}`);
}

export interface AddPhotoState {
  error: string | null;
}

/**
 * Records a photo's metadata after the browser has already uploaded the file straight to Storage
 * (see the photo-upload client component) — this action never sees the file bytes, only where
 * they landed.
 */
export async function addPhotoAction(_prev: AddPhotoState, formData: FormData): Promise<AddPhotoState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const storagePath = String(formData.get("storage_path") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();

  if (!assignmentId || !storagePath) {
    return { error: "Upload failed — no file path was returned." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_PHOTOS).insert({
    assignment_id: assignmentId,
    storage_path: storagePath,
    caption: caption || null,
    uploaded_by: user?.id ?? null,
  });

  if (error) {
    return { error: "Could not save the photo record. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface AddSignatureState {
  error: string | null;
}

export async function addSignatureAction(
  _prev: AddSignatureState,
  formData: FormData
): Promise<AddSignatureState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const signatoryName = String(formData.get("signatory_name") ?? "").trim();
  const signatureData = String(formData.get("signature_data") ?? "").trim();

  if (!assignmentId || !role || !signatoryName || !signatureData) {
    return { error: "Role, signatory name and a captured signature are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_SIGNATURES).insert({
    assignment_id: assignmentId,
    role,
    signatory_name: signatoryName,
    signature_data: signatureData,
  });

  if (error) {
    return { error: "Could not save the signature. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface UpdateNotesState {
  error: string | null;
}

export async function updateNotesAction(
  _prev: UpdateNotesState,
  formData: FormData
): Promise<UpdateNotesState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!assignmentId) {
    return { error: "Missing assignment." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({ notes: notes || null })
    .eq("id", assignmentId);

  if (error) {
    return { error: "Could not save notes. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface FinalizeAssignmentState {
  error: string | null;
}

/** Sets status + conclusion once; only succeeds while the assignment is still 'draft'. */
export async function finalizeAssignmentAction(
  _prev: FinalizeAssignmentState,
  formData: FormData
): Promise<FinalizeAssignmentState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const conclusion = String(formData.get("conclusion") ?? "").trim() as AssignmentConclusion;

  if (!assignmentId || !["pass", "conditional_pass", "fail"].includes(conclusion)) {
    return { error: "Select a conclusion before finalizing." };
  }

  const supabase = await createSupabaseServerClient();

  // A FAT/witness/pre-shipment record's signatures are the actual evidence the test was witnessed —
  // finalizing (which locks the record) without at least one captured signature would produce a
  // "complete" report with no proof anyone was there. Require at least one before allowing the
  // otherwise-irreversible status change below.
  const { count: signatureCount, error: signatureCountError } = await supabase
    .from(STANDALONE_ASSIGNMENT_SIGNATURES)
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  if (signatureCountError) {
    return { error: "Could not verify signatures. Check you have permission and try again." };
  }
  if (!signatureCount) {
    return { error: "Capture at least one signature (e.g. the witness or vendor representative) before finalizing." };
  }

  // R16: a clean pass or fail is done the moment it's finalized. A conditional pass is NOT —
  // it stays genuinely open ("conditional_open") until its punch item is closed and clearance is
  // issued via issueClearanceAction below; only then does it reach "completed".
  const finalizedStatus: AssignmentStatus = conclusion === "conditional_pass" ? "conditional_open" : "completed";

  const { data, error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({
      status: finalizedStatus,
      conclusion,
      completed_at: finalizedStatus === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", assignmentId)
    .eq("status", "draft")
    .select("id, project_id, assignment_number, equipment_description, created_by")
    .returns<
      { id: string; project_id: string; assignment_number: string; equipment_description: string; created_by: string | null }[]
    >();

  if (error) {
    return { error: "Could not finalize the assignment. Check you have permission and try again." };
  }

  if (!data || data.length === 0) {
    return { error: "This assignment has already been finalized." };
  }

  const assignment = data[0];

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", assignment.project_id)
      .maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId: assignment.project_id,
        entityType: "standalone_assignment",
        entityId: assignmentId,
        action: "finalized",
        actorId: session.userId,
        summary: `Assignment ${assignment.assignment_number} finalized — ${conclusion}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  // R95-96: a conditional pass on a FAT/witness/etc. always leaves something to close out before
  // handover — feed the project-wide punch list, same as a failed ITP-driven inspection does.
  if (conclusion === "conditional_pass") {
    await createPunchItemFromSource({
      projectId: assignment.project_id,
      description: `Conditional pass: ${assignment.equipment_description} (${assignment.assignment_number})`,
      source: "fat_conditional_pass",
      sourceStandaloneAssignmentId: assignmentId,
    });
  }

  // Best-effort: whoever ran the assignment should hear about a conclusion that leaves follow-up
  // work, without having to notice it themselves. Never blocks finalization, which already succeeded.
  if ((conclusion === "conditional_pass" || conclusion === "fail") && assignment.created_by) {
    try {
      const { data: project } = await supabase
        .from("projects")
        .select("organization_id")
        .eq("id", assignment.project_id)
        .maybeSingle<{ organization_id: string }>();

      if (project?.organization_id) {
        await createNotification(supabase, {
          organizationId: project.organization_id,
          projectId: assignment.project_id,
          recipientUserId: assignment.created_by,
          title: "Standalone assignment needs follow-up",
          body: `${assignment.equipment_description} (${assignment.assignment_number})`,
          link: `/inspect/standalone/${assignmentId}`,
        });
      }
    } catch {
      // Notification delivery is best-effort — see comment above.
    }
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface IssueClearanceState {
  error: string | null;
}

/**
 * R16's other half: closes out a "conditional_open" assignment once its punch item(s) are actually
 * cleared — the "clearance/close-out" the spec describes, distinct from the original finalize.
 * Deliberately re-checks the punch list itself (not just trusting the caller) so this can never be
 * used to skip past open items still sitting on the project's shared punch-list register.
 */
export async function issueClearanceAction(
  _prev: IssueClearanceState,
  formData: FormData
): Promise<IssueClearanceState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: STAFF_ONLY_ERROR };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();

  const { count: openCount, error: openCountError } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("source_standalone_assignment_id", assignmentId)
    .eq("status", "open");

  if (openCountError) {
    return { error: "Could not check the linked punch item(s). Try again." };
  }
  if (openCount) {
    return { error: `${openCount} linked punch item(s) still open — close them before issuing clearance.` };
  }

  const { error, data } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      cleared_by: session.userId,
      cleared_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .eq("status", "conditional_open")
    .select("id")
    .returns<{ id: string }[]>();

  if (error) {
    return { error: "Could not issue clearance. Check you have permission and try again." };
  }
  if (!data || data.length === 0) {
    return { error: "This assignment isn't awaiting clearance (already cleared, or not conditionally passed)." };
  }

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment",
        entityId: assignmentId,
        action: "clearance_issued",
        actorId: session.userId,
        summary: `Clearance issued for assignment ${assignmentRow.assignment_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}
