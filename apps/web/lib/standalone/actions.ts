"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import {
  STANDALONE_ASSIGNMENTS,
  STANDALONE_ASSIGNMENT_MEASUREMENTS,
  STANDALONE_ASSIGNMENT_PHOTOS,
  STANDALONE_ASSIGNMENT_PUNCH_ITEMS,
  STANDALONE_ASSIGNMENT_SIGNATURES,
} from "./types";

const STAFF_ONLY_ERROR = "Only JAGS staff can run a standalone assignment.";

export type AssignmentType = "fat" | "witness_inspection" | "specific_test" | "pre_shipment";
export type AssignmentStatus = "draft" | "completed";
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

  if (!projectId || !ASSIGNMENT_TYPES.includes(assignmentType) || !equipmentDescription) {
    return { error: "Project, assignment type and equipment description are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("project_number")
    .eq("id", projectId)
    .maybeSingle();

  if (!project) {
    return { error: "Project not found." };
  }

  const { count } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("assignment_type", assignmentType);

  const seq = String((count ?? 0) + 1).padStart(3, "0");
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
  const { data, error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({ status: "completed", conclusion })
    .eq("id", assignmentId)
    .eq("status", "draft")
    .select("id, project_id, assignment_number, equipment_description")
    .returns<{ id: string; project_id: string; assignment_number: string; equipment_description: string }[]>();

  if (error) {
    return { error: "Could not finalize the assignment. Check you have permission and try again." };
  }

  if (!data || data.length === 0) {
    return { error: "This assignment has already been finalized." };
  }

  // R95-96: a conditional pass on a FAT/witness/etc. always leaves something to close out before
  // handover — feed the project-wide punch list, same as a failed ITP-driven inspection does.
  if (conclusion === "conditional_pass") {
    const assignment = data[0];
    await createPunchItemFromSource({
      projectId: assignment.project_id,
      description: `Conditional pass: ${assignment.equipment_description} (${assignment.assignment_number})`,
      source: "fat_conditional_pass",
      sourceStandaloneAssignmentId: assignmentId,
    });
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}
