"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_APPROVAL_STATUSES,
  MATERIAL_RECEIPT_STATUSES,
  MATERIAL_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
  type MaterialApprovalStatus,
  type MaterialReceiptStatus,
} from "@/lib/registers/types";

export interface AddCalibrationEntryState {
  error: string | null;
}

/** Manual "add row" form on the project's Calibration Register. */
export async function addCalibrationEntryAction(
  _prev: AddCalibrationEntryState,
  formData: FormData
): Promise<AddCalibrationEntryState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const instrumentName = String(formData.get("instrument_name") ?? "").trim();
  const certNumber = String(formData.get("cert_number") ?? "").trim();
  const calDate = String(formData.get("cal_date") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !instrumentName || !certNumber || !dueDate) {
    return { error: "Instrument name, cert number, and due date are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(CALIBRATION_REGISTER_TABLE).insert({
    project_id: projectId,
    instrument_name: instrumentName,
    cert_number: certNumber,
    cal_date: calDate || null,
    due_date: dueDate,
    notes: notes || null,
  });

  if (error) {
    return { error: "Could not add the calibration entry. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

export interface AddWelderQualificationEntryState {
  error: string | null;
}

/** Manual "add row" form on the project's Welder Qualification Register. */
export async function addWelderQualificationEntryAction(
  _prev: AddWelderQualificationEntryState,
  formData: FormData
): Promise<AddWelderQualificationEntryState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const welderIdentifier = String(formData.get("welder_identifier") ?? "").trim();
  const qualifiedWps = String(formData.get("qualified_wps") ?? "").trim();
  const qualifiedRanges = String(formData.get("qualified_ranges") ?? "").trim();
  const expiryDate = String(formData.get("expiry_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !welderIdentifier || !qualifiedWps || !expiryDate) {
    return { error: "Welder identifier, qualified WPS, and expiry date are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(WELDER_QUALIFICATION_REGISTER_TABLE).insert({
    project_id: projectId,
    welder_identifier: welderIdentifier,
    qualified_wps: qualifiedWps,
    qualified_ranges: qualifiedRanges || null,
    expiry_date: expiryDate,
    notes: notes || null,
  });

  if (error) {
    return { error: "Could not add the welder qualification entry. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

export interface AddMaterialEntryState {
  error: string | null;
}

/** Manual "add row" form on the project's Material Register. */
export async function addMaterialEntryAction(
  _prev: AddMaterialEntryState,
  formData: FormData
): Promise<AddMaterialEntryState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const materialDescription = String(formData.get("material_description") ?? "").trim();
  const submittalReference = String(formData.get("submittal_reference") ?? "").trim();
  const approvalStatus = String(formData.get("approval_status") ?? "").trim() as MaterialApprovalStatus;
  const approvedDate = String(formData.get("approved_date") ?? "").trim();
  const heatNumber = String(formData.get("heat_number") ?? "").trim();
  const batchNumber = String(formData.get("batch_number") ?? "").trim();
  const poReference = String(formData.get("po_reference") ?? "").trim();
  const certificateReference = String(formData.get("certificate_reference") ?? "").trim();
  const receiptStatus = String(formData.get("receipt_status") ?? "released").trim() as MaterialReceiptStatus;
  const dispositionNotes = String(formData.get("disposition_notes") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !materialDescription || !MATERIAL_APPROVAL_STATUSES.includes(approvalStatus)) {
    return { error: "Material description and a valid approval status are required." };
  }
  if (!MATERIAL_RECEIPT_STATUSES.includes(receiptStatus)) {
    return { error: "Unrecognised receipt status." };
  }
  if (receiptStatus !== "released" && !dispositionNotes) {
    return { error: "A quarantined or on-hold material needs a disposition note explaining why." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(MATERIAL_REGISTER_TABLE).insert({
    project_id: projectId,
    material_description: materialDescription,
    submittal_reference: submittalReference || null,
    approval_status: approvalStatus,
    approved_date: approvedDate || null,
    heat_number: heatNumber || null,
    batch_number: batchNumber || null,
    po_reference: poReference || null,
    certificate_reference: certificateReference || null,
    receipt_status: receiptStatus,
    disposition_notes: dispositionNotes || null,
    notes: notes || null,
  });

  if (error) {
    return { error: "Could not add the material entry. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

export interface AddPersonnelCertificationEntryState {
  error: string | null;
}

/** Manual "add row" form on the project's Personnel Certifications register. */
export async function addPersonnelCertificationEntryAction(
  _prev: AddPersonnelCertificationEntryState,
  formData: FormData
): Promise<AddPersonnelCertificationEntryState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const projectPartyId = String(formData.get("project_party_id") ?? "").trim();
  const certificationType = String(formData.get("certification_type") ?? "").trim();
  const certNumber = String(formData.get("cert_number") ?? "").trim();
  const issuedDate = String(formData.get("issued_date") ?? "").trim();
  const expiryDate = String(formData.get("expiry_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !projectPartyId || !certificationType || !expiryDate) {
    return { error: "Person, certification type, and expiry date are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(PERSONNEL_CERTIFICATIONS_TABLE).insert({
    project_id: projectId,
    project_party_id: projectPartyId,
    certification_type: certificationType,
    cert_number: certNumber || null,
    issued_date: issuedDate || null,
    expiry_date: expiryDate,
    notes: notes || null,
  });

  if (error) {
    return { error: "Could not add the certification entry. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}
