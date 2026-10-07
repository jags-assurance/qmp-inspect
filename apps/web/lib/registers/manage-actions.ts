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
import { checkCertificateInput } from "@/lib/registers/certificate-input";
import { isMissingDbObject, REGISTER_LIFECYCLE_STATUSES, type RegisterLifecycleStatus } from "@/lib/registers/lifecycle";

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

  // A certificate can be attached or replaced after the row was created (S3-11).
  const cert = await checkCertificateInput(supabase, projectId, text(formData, "certificate_path"));
  if (cert.error) return { error: cert.error };
  if (cert.path) patch.certificate_path = cert.path;

  const { data: updated, error } = await supabase
    .from(TABLE_BY_KIND[kind])
    .update(patch)
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id");
  if (error?.code === "23505") return { error: "Another active entry with the same identifiers already exists in this register." };
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

const NEEDS_MIGRATION = "This needs a pending database update (registers verification / lifecycle). Ask an administrator to apply the latest migrations.";

/** Verifies a register entry (JAGS staff only). Until verified, an entry typed in by a contractor/sub/TPI is ignored by the soft-stop and the Data Book. */
export async function verifyRegisterEntryAction(_prev: ManageRegisterState, formData: FormData): Promise<ManageRegisterState> {
  const kind = text(formData, "kind") as RegisterKind;
  const id = text(formData, "id");
  const projectId = text(formData, "project_id");
  if (!id || !projectId || !(kind in TABLE_BY_KIND)) return { error: "Missing entry." };
  const staff = await requireStaff();
  if (staff.error) return { error: staff.error };

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from(TABLE_BY_KIND[kind])
    .update({ verified_by: staff.userId, verified_at: new Date().toISOString() })
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id");
  if (isMissingDbObject(error)) return { error: NEEDS_MIGRATION };
  if (error || !updated?.length) return { error: `Could not verify the ${KIND_LABEL[kind]}. Check you have permission and try again.` };

  await audit(supabase, projectId, staff.userId, `${kind}_register_entry`, id, "verified", `${KIND_LABEL[kind]} verified by JAGS staff`);
  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

/**
 * Marks an entry superseded / retired / withdrawn (reason required), or reactivates it. A retired entry is
 * kept as evidence for the inspections that used it but no longer counts toward the Data Book readiness.
 */
export async function setRegisterLifecycleAction(_prev: ManageRegisterState, formData: FormData): Promise<ManageRegisterState> {
  const kind = text(formData, "kind") as RegisterKind;
  const id = text(formData, "id");
  const projectId = text(formData, "project_id");
  const next = text(formData, "lifecycle_status") as RegisterLifecycleStatus;
  const reason = text(formData, "reason").slice(0, 500);
  if (!id || !projectId || !(kind in TABLE_BY_KIND)) return { error: "Missing entry." };
  if (!REGISTER_LIFECYCLE_STATUSES.includes(next)) return { error: "Unrecognised status." };
  if (next !== "active" && !reason) return { error: "Give a short reason (for example 'welder left the project' or 'replaced by thermometer T-12')." };
  const staff = await requireStaff();
  if (staff.error) return { error: staff.error };

  const supabase = await createSupabaseServerClient();
  const { data: updated, error } = await supabase
    .from(TABLE_BY_KIND[kind])
    .update({
      lifecycle_status: next,
      lifecycle_reason: next === "active" ? null : reason,
      lifecycle_changed_by: staff.userId,
      lifecycle_changed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id");
  if (isMissingDbObject(error)) return { error: NEEDS_MIGRATION };
  if (error?.code === "23505") return { error: "Another active entry with the same identifiers exists, so this one can't be reactivated." };
  if (error || !updated?.length) return { error: `Could not update the ${KIND_LABEL[kind]}. Check you have permission and try again.` };

  await audit(supabase, projectId, staff.userId, `${kind}_register_entry`, id, "lifecycle_changed", `${KIND_LABEL[kind]} marked ${next}${reason ? `: ${reason}` : ""}`);
  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

/**
 * Recalibrates an instrument: the old row is kept (superseded, with the as-found result of the cycle that
 * just ended) and a NEW row is created, linked back to it. Every checklist answer already linked to the old
 * row keeps pointing at the certificate that was valid when it was used, so an out-of-tolerance finding can
 * still be traced back through the whole previous cycle (see the traceability impact report).
 */
export async function recalibrateInstrumentAction(_prev: ManageRegisterState, formData: FormData): Promise<ManageRegisterState> {
  const id = text(formData, "id");
  const projectId = text(formData, "project_id");
  const certNumber = text(formData, "cert_number");
  const calDate = text(formData, "cal_date");
  const dueDate = text(formData, "due_date");
  const asFound = text(formData, "as_found_result") || "not_recorded";
  const asFoundNotes = text(formData, "as_found_notes").slice(0, 1000);
  if (!id || !projectId) return { error: "Missing entry." };
  if (!certNumber || !calDate || !dueDate) return { error: "The new certificate number, calibration date and due date are required." };
  const problem = badDate(calDate, "The calibration date") ?? badDate(dueDate, "The due date");
  if (problem) return { error: problem };
  if (dueDate < calDate) return { error: "The due date can't be before the calibration date." };
  if (!["in_tolerance", "out_of_tolerance", "not_recorded"].includes(asFound)) return { error: "Unrecognised as-found result." };
  if (asFound === "out_of_tolerance" && !asFoundNotes) return { error: "Describe the out-of-tolerance finding so the impacted inspections can be assessed." };
  const staff = await requireStaff();
  if (staff.error) return { error: staff.error };

  const supabase = await createSupabaseServerClient();
  const cert = await checkCertificateInput(supabase, projectId, text(formData, "certificate_path"));
  if (cert.error) return { error: cert.error };

  const { data: old } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .select("instrument_name, instrument_tag, calibration_lab, cert_number, cal_date, due_date, notes, lifecycle_status")
    .eq("id", id)
    .eq("project_id", projectId)
    .maybeSingle<{ instrument_name: string; instrument_tag: string | null; calibration_lab: string | null; cert_number: string; cal_date: string | null; due_date: string; notes: string | null; lifecycle_status: string | null }>();
  if (!old) return { error: "Calibration entry not found." };
  if (old.lifecycle_status && old.lifecycle_status !== "active") return { error: "That entry has already been superseded or retired." };
  if (old.cert_number.toLowerCase() === certNumber.toLowerCase()) return { error: "The new certificate number must differ from the one being replaced." };

  const { data: created, error: insertError } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .insert({
      project_id: projectId,
      instrument_name: old.instrument_name,
      instrument_tag: old.instrument_tag,
      calibration_lab: text(formData, "calibration_lab") || old.calibration_lab,
      cert_number: certNumber,
      cal_date: calDate,
      due_date: dueDate,
      status: computeCalibrationStatus(dueDate),
      certificate_path: cert.path,
      notes: old.notes,
      supersedes_id: id,
    })
    .select("id")
    .single<{ id: string }>();
  if (isMissingDbObject(insertError)) return { error: NEEDS_MIGRATION };
  if (insertError?.code === "23505") return { error: `${old.instrument_name} with certificate ${certNumber} is already in this register.` };
  if (insertError || !created) return { error: "Could not record the recalibration. Check you have permission and try again." };

  const { error: supersedeError } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .update({
      lifecycle_status: "superseded",
      lifecycle_reason: `Recalibrated — replaced by certificate ${certNumber}`,
      lifecycle_changed_by: staff.userId,
      lifecycle_changed_at: new Date().toISOString(),
      as_found_result: asFound,
      as_found_notes: asFoundNotes || null,
      as_found_recorded_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (supersedeError) {
    // Don't leave two active rows for one instrument: undo the new row.
    await supabase.from(CALIBRATION_REGISTER_TABLE).delete().eq("id", created.id);
    return { error: "Could not supersede the previous calibration, so nothing was changed. Try again." };
  }

  await audit(
    supabase,
    projectId,
    staff.userId,
    "calibration_register_entry",
    created.id,
    "recalibrated",
    `${old.instrument_name} recalibrated (cert ${old.cert_number} -> ${certNumber}); as-found: ${asFound.replace(/_/g, " ")}${asFoundNotes ? ` — ${asFoundNotes}` : ""}`
  );
  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}
