"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_APPROVAL_STATUSES,
  MATERIAL_RECEIPT_STATUSES,
  MATERIAL_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  type MaterialApprovalStatus,
  type MaterialReceiptStatus,
} from "@/lib/registers/types";
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus } from "@/lib/registers/status";

export type RegisterKind = "calibration" | "welder" | "material" | "personnel";

export interface ManageRegisterState {
  error: string | null;
}

const TABLE_BY_KIND = {
  calibration: CALIBRATION_REGISTER_TABLE,
  welder: WELDER_QUALIFICATION_REGISTER_TABLE,
  material: MATERIAL_REGISTER_TABLE,
  personnel: PERSONNEL_CERTIFICATIONS_TABLE,
} as const;

const KIND_LABEL: Record<RegisterKind, string> = {
  calibration: "calibration entry",
  welder: "welder qualification",
  material: "material entry",
  personnel: "personnel certification",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function badDate(value: string, label: string): string | null {
  if (!value) return null;
  if (!ISO_DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return `${label} isn't a valid date.`;
  return null;
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function requireStaff(): Promise<{ error: string | null; userId: string }> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit, release or delete register entries.", userId: session.userId };
  return { error: null, userId: session.userId };
}

async function audit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string,
  actorId: string,
  entityType: string,
  entityId: string,
  action: string,
  summary: string
) {
  try {
    const { data: project } = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>();
    if (!project?.organization_id) return;
    await recordAuditEvent(supabase, { organizationId: project.organization_id, projectId, entityType, entityId, action, actorId, summary });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }
}

/**
 * Edits one register entry (JAGS staff only). Only the fields shown in the edit form are accepted; the
 * status of a dated entry is recomputed from its date. For a material, changing the receipt status to
 * "released" is how it is released (the database stamps who and when).
 */
export async function updateRegisterEntryAction(_prev: ManageRegisterState, formData: FormData): Promise<ManageRegisterState> {
  const kind = text(formData, "kind") as RegisterKind;
  const id = text(formData, "id");
  const projectId = text(formData, "project_id");
  if (!id || !projectId || !(kind in TABLE_BY_KIND)) return { error: "Missing entry." };

  const staff = await requireStaff();
  if (staff.error) return { error: staff.error };

  const supabase = await createSupabaseServerClient();
  let patch: Record<string, unknown> = {};
  let summary = "";

  if (kind === "calibration") {
    const instrumentName = text(formData, "instrument_name");
    const certNumber = text(formData, "cert_number");
    const calDate = text(formData, "cal_date");
    const dueDate = text(formData, "due_date");
    if (!instrumentName || !certNumber || !dueDate) return { error: "Instrument name, cert number and due date are required." };
    const problem = badDate(calDate, "The calibration date") ?? badDate(dueDate, "The due date");
    if (problem) return { error: problem };
    if (calDate && dueDate < calDate) return { error: "The due date can't be before the calibration date." };
    patch = {
      instrument_name: instrumentName,
      instrument_tag: text(formData, "instrument_tag") || null,
      calibration_lab: text(formData, "calibration_lab") || null,
      cert_number: certNumber,
      cal_date: calDate || null,
      due_date: dueDate,
      status: computeCalibrationStatus(dueDate),
      notes: text(formData, "notes") || null,
    };
    summary = `Calibration entry edited: ${instrumentName} (${certNumber})`;
  } else if (kind === "welder") {
    const welderIdentifier = text(formData, "welder_identifier");
    const qualifiedWps = text(formData, "qualified_wps");
    const expiryDate = text(formData, "expiry_date");
    if (!welderIdentifier || !qualifiedWps || !expiryDate) return { error: "Welder identifier, qualified WPS and expiry date are required." };
    const problem = badDate(expiryDate, "The expiry date");
    if (problem) return { error: problem };
    patch = {
      welder_identifier: welderIdentifier,
      wpq_number: text(formData, "wpq_number") || null,
      process: text(formData, "process") || null,
      position: text(formData, "position") || null,
      qualified_wps: qualifiedWps,
      qualified_ranges: text(formData, "qualified_ranges") || null,
      expiry_date: expiryDate,
      status: computeWelderStatus(expiryDate),
      notes: text(formData, "notes") || null,
    };
    summary = `Welder qualification edited: ${welderIdentifier}`;
  } else if (kind === "personnel") {
    const certificationType = text(formData, "certification_type");
    const issuedDate = text(formData, "issued_date");
    const expiryDate = text(formData, "expiry_date");
    if (!certificationType || !expiryDate) return { error: "Certification type and expiry date are required." };
    const problem = badDate(issuedDate, "The issue date") ?? badDate(expiryDate, "The expiry date");
    if (problem) return { error: problem };
    if (issuedDate && expiryDate < issuedDate) return { error: "The expiry date can't be before the issue date." };
    patch = {
      certification_type: certificationType,
      cert_number: text(formData, "cert_number") || null,
      issued_date: issuedDate || null,
      expiry_date: expiryDate,
      status: computePersonnelCertificationStatus(expiryDate),
      notes: text(formData, "notes") || null,
    };
    summary = `Personnel certification edited: ${certificationType}`;
  } else {
    const description = text(formData, "material_description");
    const approvalStatus = text(formData, "approval_status") as MaterialApprovalStatus;
    const receiptStatus = text(formData, "receipt_status") as MaterialReceiptStatus;
    const dispositionNotes = text(formData, "disposition_notes");
    const approvedDate = text(formData, "approved_date");
    if (!description || !MATERIAL_APPROVAL_STATUSES.includes(approvalStatus)) return { error: "Description and a valid approval status are required." };
    if (!MATERIAL_RECEIPT_STATUSES.includes(receiptStatus)) return { error: "Unrecognised receipt status." };
    if ((receiptStatus === "quarantined_pending_disposition" || receiptStatus === "on_hold") && !dispositionNotes) {
      return { error: "A quarantined or on-hold material needs a disposition note explaining why." };
    }
    const problem = badDate(approvedDate, "The approved date");
    if (problem) return { error: problem };
    patch = {
      material_description: description,
      submittal_reference: text(formData, "submittal_reference") || null,
      approval_status: approvalStatus,
      approved_date: approvedDate || null,
      heat_number: text(formData, "heat_number") || null,
      batch_number: text(formData, "batch_number") || null,
      po_reference: text(formData, "po_reference") || null,
      supplier: text(formData, "supplier") || null,
      quantity: text(formData, "quantity") || null,
      certificate_reference: text(formData, "certificate_reference") || null,
      receipt_status: receiptStatus,
      disposition_notes: dispositionNotes || null,
      notes: text(formData, "notes") || null,
    };
    summary = `Material entry edited: ${description} (${approvalStatus}/${receiptStatus})`;
  }

  const { data: updated, error } = await supabase
    .from(TABLE_BY_KIND[kind])
    .update(patch)
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id");
  if (error || !updated?.length) return { error: `Could not update the ${KIND_LABEL[kind]}. Check you have permission and try again.` };

  await audit(supabase, projectId, staff.userId, `${kind}_register_entry`, id, "updated", summary);
  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

/** Deletes one register entry (JAGS staff only) — refused when inspection records already point at it. */
export async function deleteRegisterEntryAction(_prev: ManageRegisterState, formData: FormData): Promise<ManageRegisterState> {
  const kind = text(formData, "kind") as RegisterKind;
  const id = text(formData, "id");
  const projectId = text(formData, "project_id");
  if (!id || !projectId || !(kind in TABLE_BY_KIND)) return { error: "Missing entry." };

  const staff = await requireStaff();
  if (staff.error) return { error: staff.error };

  const supabase = await createSupabaseServerClient();

  // An entry that inspections were verified against keeps its history: deleting it would silently
  // null the traceability link on every one of those checklist answers.
  const linkColumn = kind === "calibration" ? "calibration_asset_id" : kind === "material" ? "material_id" : kind === "welder" ? "welder_id" : null;
  if (linkColumn) {
    const { count } = await supabase
      .from("checklist_responses")
      .select("id", { count: "exact", head: true })
      .eq(linkColumn as never, id as never);
    if (count) {
      return {
        error: `${count} inspection ${count === 1 ? "answer was" : "answers were"} verified against this ${KIND_LABEL[kind]}, so it can't be deleted. Edit it instead (for example, mark a material on hold or correct the dates).`,
      };
    }
  }

  const { data: deleted, error } = await supabase.from(TABLE_BY_KIND[kind]).delete().eq("id", id).eq("project_id", projectId).select("id");
  if (error || !deleted?.length) return { error: `Could not delete the ${KIND_LABEL[kind]}. Check you have permission and try again.` };

  await audit(supabase, projectId, staff.userId, `${kind}_register_entry`, id, "deleted", `${KIND_LABEL[kind]} deleted`);
  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}
