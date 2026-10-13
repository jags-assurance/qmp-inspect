"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
import { requireSession } from "@/lib/auth/session";
import { getRegisterAccess } from "@/lib/registers/permissions";
import { checkCertificateInput } from "@/lib/registers/certificate-input";
import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus } from "@/lib/registers/status";
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
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import type { ExtractedCalibrationRow, ExtractedMaterialRow, ExtractedWelderRow } from "@/lib/ai/provider";

async function auditRegisterEntry(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: { projectId: string; entityType: string; entityId: string; action: string; summary: string }
): Promise<void> {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", params.projectId)
      .maybeSingle<{ organization_id: string }>();
    if (!project?.organization_id) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await recordAuditEvent(supabase, {
      organizationId: project.organization_id,
      projectId: params.projectId,
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      actorId: user?.id ?? null,
      summary: params.summary,
    });
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }
}

/** Shared guard for every register write: signed in, and allowed to add entries on this project. */
async function requireRegisterContributor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string
): Promise<{ error: string | null; isStaff: boolean }> {
  const session = await requireSession();
  const access = await getRegisterAccess(supabase, session, projectId);
  if (!access.canAdd) {
    return { error: "Only JAGS staff and this project's contractor, subcontractor or TPI/lab parties can add register entries.", isStaff: false };
  }
  return { error: null, isStaff: access.canManage };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A user-typed date must be a real calendar date (the form's date picker guarantees the format; this guards direct posts). */
function badDate(value: string, label: string): string | null {
  if (!value) return null;
  if (!ISO_DATE.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return `${label} isn't a valid date.`;
  const year = Number(value.slice(0, 4));
  if (year < 1990 || year > 2100) return `${label} looks wrong (year ${year}).`;
  return null;
}

/** Certificate files are uploaded straight to storage by the form; only accept a path under THIS project's registers folder (<project>/registers/…, which the storage policy already scopes to project access). */
const DUPLICATE_MESSAGE = "An active entry with the same identifiers already exists in this register — edit it or recalibrate/renew it instead.";

async function entryExists(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: unknown,
  projectId: string,
  match: Record<string, string>
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registers tables aren't in the generated types
  let query: any = supabase.from(table as never).select("id", { count: "exact", head: true }).eq("project_id" as never, projectId as never);
  for (const [column, value] of Object.entries(match)) query = query.ilike(column, value.replace(/[%_\\]/g, (m) => `\\${m}`));
  const { count } = await query;
  return (count ?? 0) > 0;
}

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
  const instrumentTag = String(formData.get("instrument_tag") ?? "").trim();
  const calibrationLab = String(formData.get("calibration_lab") ?? "").trim();
  const certNumber = String(formData.get("cert_number") ?? "").trim();
  const calDate = String(formData.get("cal_date") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !instrumentName || !certNumber || !dueDate) {
    return { error: "Instrument name, cert number, and due date are required." };
  }
  const dateProblem = badDate(calDate, "The calibration date") ?? badDate(dueDate, "The due date");
  if (dateProblem) return { error: dateProblem };
  if (calDate && dueDate < calDate) return { error: "The due date can't be before the calibration date." };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { error: writer.error };

  if (await entryExists(supabase, CALIBRATION_REGISTER_TABLE, projectId, { cert_number: certNumber, instrument_name: instrumentName })) {
    return { error: `${instrumentName} with certificate ${certNumber} is already in this register.` };
  }

  const cert = await checkCertificateInput(supabase, projectId, String(formData.get("certificate_path") ?? ""));
  if (cert.error) return { error: cert.error };

  const { data: entry, error } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .insert({
      project_id: projectId,
      instrument_name: instrumentName,
      instrument_tag: instrumentTag || null,
      calibration_lab: calibrationLab || null,
      cert_number: certNumber,
      cal_date: calDate || null,
      due_date: dueDate,
      status: computeCalibrationStatus(dueDate),
      certificate_path: cert.path,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error?.code === "23505") return { error: DUPLICATE_MESSAGE };
  if (error || !entry) {
    return { error: "Could not add the calibration entry. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "calibration_register_entry",
    entityId: entry.id,
    action: "created",
    summary: `Calibration entry added: ${instrumentName} (${certNumber})`,
  });

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
  const wpqNumber = String(formData.get("wpq_number") ?? "").trim();
  const process = String(formData.get("process") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim();
  const qualifiedWps = String(formData.get("qualified_wps") ?? "").trim();
  const qualifiedRanges = String(formData.get("qualified_ranges") ?? "").trim();
  const expiryDate = String(formData.get("expiry_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !welderIdentifier || !qualifiedWps || !expiryDate) {
    return { error: "Welder identifier, qualified WPS, and expiry date are required." };
  }
  const dateProblem = badDate(expiryDate, "The expiry date");
  if (dateProblem) return { error: dateProblem };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { error: writer.error };

  if (await entryExists(supabase, WELDER_QUALIFICATION_REGISTER_TABLE, projectId, { welder_identifier: welderIdentifier, qualified_wps: qualifiedWps })) {
    return { error: `${welderIdentifier} is already qualified on ${qualifiedWps} in this register — edit that entry instead.` };
  }

  const cert = await checkCertificateInput(supabase, projectId, String(formData.get("certificate_path") ?? ""));
  if (cert.error) return { error: cert.error };

  const { data: entry, error } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .insert({
      project_id: projectId,
      welder_identifier: welderIdentifier,
      wpq_number: wpqNumber || null,
      process: process || null,
      position: position || null,
      qualified_wps: qualifiedWps,
      qualified_ranges: qualifiedRanges || null,
      expiry_date: expiryDate,
      status: computeWelderStatus(expiryDate),
      certificate_path: cert.path,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error?.code === "23505") return { error: DUPLICATE_MESSAGE };
  if (error || !entry) {
    return { error: "Could not add the welder qualification entry. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "welder_qualification_entry",
    entityId: entry.id,
    action: "created",
    summary: `Welder qualification entry added: ${welderIdentifier}`,
  });

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

export interface AddMaterialEntryState {
  error: string | null;
}

/**
 * Manual "add row" form on the project's Material Register. A material added by a contractor party is
 * always recorded as "received — pending inspection" (the database enforces it too): only JAGS staff
 * can release a material.
 */
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
  const supplier = String(formData.get("supplier") ?? "").trim();
  const quantity = String(formData.get("quantity") ?? "").trim();
  const certificateReference = String(formData.get("certificate_reference") ?? "").trim();
  const requestedReceiptStatus = String(formData.get("receipt_status") ?? "released").trim() as MaterialReceiptStatus;
  const dispositionNotes = String(formData.get("disposition_notes") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !materialDescription || !MATERIAL_APPROVAL_STATUSES.includes(approvalStatus)) {
    return { error: "Material description and a valid approval status are required." };
  }
  if (!MATERIAL_RECEIPT_STATUSES.includes(requestedReceiptStatus)) {
    return { error: "Unrecognised receipt status." };
  }
  const dateProblem = badDate(approvedDate, "The approved date");
  if (dateProblem) return { error: dateProblem };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { error: writer.error };

  const receiptStatus: MaterialReceiptStatus = writer.isStaff ? requestedReceiptStatus : "received_pending_inspection";
  if (writer.isStaff && receiptStatus !== "released" && receiptStatus !== "received_pending_inspection" && !dispositionNotes) {
    return { error: "A quarantined or on-hold material needs a disposition note explaining why." };
  }
  if (heatNumber && (await entryExists(supabase, MATERIAL_REGISTER_TABLE, projectId, { heat_number: heatNumber, material_description: materialDescription }))) {
    return { error: `${materialDescription} with heat number ${heatNumber} is already in this register.` };
  }

  const cert = await checkCertificateInput(supabase, projectId, String(formData.get("certificate_path") ?? ""));
  if (cert.error) return { error: cert.error };

  const { data: entry, error } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .insert({
      project_id: projectId,
      material_description: materialDescription,
      submittal_reference: submittalReference || null,
      // A contractor's own row shows "A — Approved" by default in the form, before any JAGS review: only
      // staff set the submittal approval, so theirs lands as "C" (not yet reviewed), like extracted rows.
      approval_status: writer.isStaff ? approvalStatus : ("C" as const),
      approved_date: writer.isStaff ? approvedDate || null : null,
      heat_number: heatNumber || null,
      batch_number: batchNumber || null,
      po_reference: poReference || null,
      supplier: supplier || null,
      quantity: quantity || null,
      certificate_reference: certificateReference || null,
      certificate_path: cert.path,
      receipt_status: receiptStatus,
      disposition_notes: dispositionNotes || null,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error?.code === "23505") return { error: DUPLICATE_MESSAGE };
  if (error || !entry) {
    return { error: "Could not add the material entry. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "material_register_entry",
    entityId: entry.id,
    action: "created",
    summary: `Material entry added: ${materialDescription} (${approvalStatus}/${receiptStatus})`,
  });

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
  const dateProblem = badDate(issuedDate, "The issue date") ?? badDate(expiryDate, "The expiry date");
  if (dateProblem) return { error: dateProblem };
  if (issuedDate && expiryDate < issuedDate) return { error: "The expiry date can't be before the issue date." };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { error: writer.error };

  const { data: partyRow } = await supabase
    .from("project_parties")
    .select("id")
    .eq("id", projectPartyId)
    .eq("project_id", projectId)
    .maybeSingle<{ id: string }>();
  if (!partyRow) return { error: "That person isn't a party on this project." };

  // Optional: the certificate belongs to one named person (a member of that party), not the whole party.
  const holderUserId = String(formData.get("holder_user_id") ?? "").trim();
  if (holderUserId) {
    const [{ data: primary }, { data: member }] = await Promise.all([
      supabase.from("project_parties").select("id").eq("id", projectPartyId).eq("user_id", holderUserId).maybeSingle<{ id: string }>(),
      supabase.from(PROJECT_PARTY_MEMBERS_TABLE).select("id").eq("project_party_id", projectPartyId).eq("user_id", holderUserId).maybeSingle<{ id: string }>(),
    ]);
    if (!primary && !member) return { error: "That person isn't a member of the selected party." };
  }

  if (certNumber) {
    const { count } = await supabase
      .from(PERSONNEL_CERTIFICATIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("project_party_id", projectPartyId)
      .eq("certification_type", certificationType)
      .eq("cert_number", certNumber);
    if (count) return { error: `Certificate ${certNumber} (${certificationType}) is already recorded for this person.` };
  }

  const cert = await checkCertificateInput(supabase, projectId, String(formData.get("certificate_path") ?? ""));
  if (cert.error) return { error: cert.error };

  const { data: entry, error } = await supabase
    .from(PERSONNEL_CERTIFICATIONS_TABLE)
    .insert({
      project_id: projectId,
      project_party_id: projectPartyId,
      ...(holderUserId ? { holder_user_id: holderUserId } : {}),
      certification_type: certificationType,
      cert_number: certNumber || null,
      issued_date: issuedDate || null,
      expiry_date: expiryDate,
      status: computePersonnelCertificationStatus(expiryDate),
      certificate_path: cert.path,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

  if (error?.code === "23505") return { error: DUPLICATE_MESSAGE };
  if (error || !entry) {
    return { error: "Could not add the certification entry. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "personnel_certification_entry",
    entityId: entry.id,
    action: "created",
    summary: `Personnel certification added: ${certificationType}`,
  });

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return { error: null };
}

// --- AI extraction (Reqs from the client's register sample pack) ------------------------------
//
// Mirrors the existing "AI drafts, human reviews, existing create action persists" pattern used by
// the ITP/NCR/report-narrative workflows — no new pipeline. sourceText is either extracted vault
// document text (certificates, WPQs, submittals/CoCs) the caller has already fetched, or free-typed
// text pasted directly. None of the three extract*Action functions below write to the database;
// they only return draft rows for the document controller to review, edit, or discard before the
// corresponding addExtracted*RowsAction persists whatever's actually submitted.

export interface ExtractCalibrationRowsState {
  error: string | null;
  rows: ExtractedCalibrationRow[];
  aiLogId: string | null;
}

const EMPTY_EXTRACT_CALIBRATION_STATE: ExtractCalibrationRowsState = { error: null, rows: [], aiLogId: null };

export async function extractCalibrationRowsAction(
  _prev: ExtractCalibrationRowsState,
  formData: FormData
): Promise<ExtractCalibrationRowsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const sourceText = String(formData.get("source_text") ?? "").trim().slice(0, 200_000);

  if (!projectId || !sourceText) {
    return { ...EMPTY_EXTRACT_CALIBRATION_STATE, error: "Select a project and provide some certificate text to extract from." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_EXTRACT_CALIBRATION_STATE, error: "Project not found, or you don't have access to it." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_EXTRACT_CALIBRATION_STATE, error: gate.reason };

  try {
    // The same certificate text pasted twice (a re-submit, or the same cert used on more than one
    // register) reuses the prior extraction instead of paying for it again — the source text alone
    // determines the output, not which project it's being extracted into.
    const inputHash = hashAiCacheInput(sourceText);
    const cached = await findCachedAiResponse<ExtractedCalibrationRow[]>(supabase, {
      organizationId: project.organization_id,
      feature: "calibration_register_extraction",
      promptVersion: PROMPT_VERSIONS.calibration_register_extraction,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let rows: ExtractedCalibrationRow[];
    if (cached) {
      rows = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.extractCalibrationRows({ sourceText }));
      rows = captured.result;
      usage = captured.usage;
    }
    if (rows.length === 0) {
      return { ...EMPTY_EXTRACT_CALIBRATION_STATE, error: "No calibration entries could be identified in that text." };
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId,
      userId: user?.id ?? null,
      feature: "calibration_register_extraction",
      modelId: getGeminiModel("calibration_register_extraction"),
      promptVersion: PROMPT_VERSIONS.calibration_register_extraction,
      sourceRef: { projectId, sourceTextLength: sourceText.length },
      aiResponse: rows,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, rows, aiLogId: logId };
  } catch (err) {
    return {
      ...EMPTY_EXTRACT_CALIBRATION_STATE,
      error: aiErrorMessage(err, "Could not extract calibration entries from that text."),
    };
  }
}

export interface AddExtractedRowsState {
  error: string | null;
  addedCount: number;
}

const EMPTY_ADD_EXTRACTED_STATE: AddExtractedRowsState = { error: null, addedCount: 0 };

function extractedSkipMessage(skipped: number, reasons: { missing: number; invalid: number; duplicate: number }): string {
  const parts: string[] = [];
  if (reasons.missing) parts.push(`${reasons.missing} missing a required field`);
  if (reasons.invalid) parts.push(`${reasons.invalid} with an invalid or inconsistent date`);
  if (reasons.duplicate) parts.push(`${reasons.duplicate} already in the register`);
  return `${skipped} row(s) skipped: ${parts.join(", ")}.`;
}

/** Persists the (reviewed, possibly edited) calibration rows a document controller confirms after
 *  extraction — the only thing that ever writes AI-extracted calibration data to the database. */
export async function addExtractedCalibrationRowsAction(
  _prev: AddExtractedRowsState,
  formData: FormData
): Promise<AddExtractedRowsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const rowsJson = String(formData.get("rows_json") ?? "");
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;

  if (!projectId || !rowsJson) return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Missing project or rows to add." };

  let rows: ExtractedCalibrationRow[];
  try {
    rows = JSON.parse(rowsJson) as ExtractedCalibrationRow[];
  } catch {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "The extracted rows could not be read — please re-extract." };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ...EMPTY_ADD_EXTRACTED_STATE, error: "No rows to add." };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { ...EMPTY_ADD_EXTRACTED_STATE, error: writer.error };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // due_date is not-null on calibration_register — a row with no due date is never inferred; it is
  // skipped and reported so the document controller can add it by hand once confirmed.
  const insertable: ExtractedCalibrationRow[] = [];
  const reasons = { missing: 0, invalid: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.instrumentName?.trim();
    const cert = r.certNumber?.trim();
    const due = r.dueDate?.trim();
    const cal = r.calDate?.trim() ?? "";
    if (!name || !cert || !due) { reasons.missing++; continue; }
    if (badDate(cal, "Calibration date") || badDate(due, "Due date") || (cal && due < cal)) { reasons.invalid++; continue; }
    const key = `${cert.toLowerCase()}|${name.toLowerCase()}`;
    if (seen.has(key) || (await entryExists(supabase, CALIBRATION_REGISTER_TABLE, projectId, { cert_number: cert, instrument_name: name }))) {
      reasons.duplicate++;
      continue;
    }
    seen.add(key);
    insertable.push({ ...r, instrumentName: name, certNumber: cert, calDate: cal || null, dueDate: due });
  }
  const skipped = reasons.missing + reasons.invalid + reasons.duplicate;
  const skipReason = extractedSkipMessage(skipped, reasons);

  if (insertable.length === 0) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: `No rows were added. ${skipReason}` };
  }

  const { data: inserted, error } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .insert(
      insertable.map((r) => ({
        project_id: projectId,
        instrument_name: r.instrumentName,
        cert_number: r.certNumber,
        cal_date: r.calDate || null,
        due_date: r.dueDate,
        status: computeCalibrationStatus(r.dueDate as string),
        notes: ((r as { notes?: string | null }).notes ?? "").toString().trim() || null,
      }))
    )
    .select("id");

  if (error || !inserted) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Could not add the extracted rows. Check you have permission and try again." };
  }

  for (const row of inserted as unknown as { id: string }[]) {
    await auditRegisterEntry(supabase, {
      projectId,
      entityType: "calibration_register_entry",
      entityId: row.id,
      action: "ai_extracted_added",
      summary: `AI-extracted calibration entry added${skipped > 0 ? ` (batch of ${inserted.length} added, ${skipped} skipped)` : ""}`,
    });
  }

  if (aiLogId && user?.id) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: user.id,
      targetType: "calibration_register_batch",
      targetId: projectId,
      reviewedResponse: { addedRows: insertable, skippedCount: skipped },
      decision: skipped > 0 || JSON.stringify(insertable) !== JSON.stringify(rows) ? "edited_and_accepted" : "accepted_as_is",
    });
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return {
    error: skipped > 0 ? `${inserted.length} row(s) added. ${skipReason}` : null,
    addedCount: inserted.length,
  };
}

export interface ExtractWelderRowsState {
  error: string | null;
  rows: ExtractedWelderRow[];
  aiLogId: string | null;
}

const EMPTY_EXTRACT_WELDER_STATE: ExtractWelderRowsState = { error: null, rows: [], aiLogId: null };

export async function extractWelderRowsAction(
  _prev: ExtractWelderRowsState,
  formData: FormData
): Promise<ExtractWelderRowsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const sourceText = String(formData.get("source_text") ?? "").trim().slice(0, 200_000);

  if (!projectId || !sourceText) {
    return { ...EMPTY_EXTRACT_WELDER_STATE, error: "Select a project and provide some WPQ text to extract from." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_EXTRACT_WELDER_STATE, error: "Project not found, or you don't have access to it." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_EXTRACT_WELDER_STATE, error: gate.reason };

  try {
    const inputHash = hashAiCacheInput(sourceText);
    const cached = await findCachedAiResponse<ExtractedWelderRow[]>(supabase, {
      organizationId: project.organization_id,
      feature: "welder_register_extraction",
      promptVersion: PROMPT_VERSIONS.welder_register_extraction,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let rows: ExtractedWelderRow[];
    if (cached) {
      rows = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.extractWelderRows({ sourceText }));
      rows = captured.result;
      usage = captured.usage;
    }
    if (rows.length === 0) {
      return { ...EMPTY_EXTRACT_WELDER_STATE, error: "No welder qualification entries could be identified in that text." };
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId,
      userId: user?.id ?? null,
      feature: "welder_register_extraction",
      modelId: getGeminiModel("welder_register_extraction"),
      promptVersion: PROMPT_VERSIONS.welder_register_extraction,
      sourceRef: { projectId, sourceTextLength: sourceText.length },
      aiResponse: rows,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, rows, aiLogId: logId };
  } catch (err) {
    return {
      ...EMPTY_EXTRACT_WELDER_STATE,
      error: aiErrorMessage(err, "Could not extract welder entries from that text."),
    };
  }
}

export async function addExtractedWelderRowsAction(
  _prev: AddExtractedRowsState,
  formData: FormData
): Promise<AddExtractedRowsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const rowsJson = String(formData.get("rows_json") ?? "");
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;

  if (!projectId || !rowsJson) return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Missing project or rows to add." };

  let rows: ExtractedWelderRow[];
  try {
    rows = JSON.parse(rowsJson) as ExtractedWelderRow[];
  } catch {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "The extracted rows could not be read — please re-extract." };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ...EMPTY_ADD_EXTRACTED_STATE, error: "No rows to add." };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { ...EMPTY_ADD_EXTRACTED_STATE, error: writer.error };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // expiry_date is not-null on welder_qualification_register — skip a row missing it rather than inventing one.
  const insertable: ExtractedWelderRow[] = [];
  const reasons = { missing: 0, invalid: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.welderIdentifier?.trim();
    const exp = r.expiryDate?.trim();
    if (!id || !exp) { reasons.missing++; continue; }
    if (badDate(exp, "Expiry date")) { reasons.invalid++; continue; }
    const wps = r.qualifiedWps?.trim() || "Not confirmed in source";
    const key = `${id.toLowerCase()}|${wps.toLowerCase()}`;
    if (seen.has(key) || (await entryExists(supabase, WELDER_QUALIFICATION_REGISTER_TABLE, projectId, { welder_identifier: id, qualified_wps: wps }))) {
      reasons.duplicate++;
      continue;
    }
    seen.add(key);
    insertable.push({ ...r, welderIdentifier: id, qualifiedWps: wps, expiryDate: exp });
  }
  const skipped = reasons.missing + reasons.invalid + reasons.duplicate;
  const skipReason = extractedSkipMessage(skipped, reasons);

  if (insertable.length === 0) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: `No rows were added. ${skipReason}` };
  }

  const { data: inserted, error } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .insert(
      insertable.map((r) => ({
        project_id: projectId,
        welder_identifier: r.welderIdentifier,
        qualified_wps: r.qualifiedWps,
        qualified_ranges: r.qualifiedRanges || null,
        expiry_date: r.expiryDate,
        status: computeWelderStatus(r.expiryDate as string),
      }))
    )
    .select("id");

  if (error || !inserted) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Could not add the extracted rows. Check you have permission and try again." };
  }

  for (const row of inserted as unknown as { id: string }[]) {
    await auditRegisterEntry(supabase, {
      projectId,
      entityType: "welder_qualification_entry",
      entityId: row.id,
      action: "ai_extracted_added",
      summary: `AI-extracted welder qualification entry added${skipped > 0 ? ` (batch of ${inserted.length} added, ${skipped} skipped)` : ""}`,
    });
  }

  if (aiLogId && user?.id) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: user.id,
      targetType: "welder_register_batch",
      targetId: projectId,
      reviewedResponse: { addedRows: insertable, skippedCount: skipped },
      decision: skipped > 0 || JSON.stringify(insertable) !== JSON.stringify(rows) ? "edited_and_accepted" : "accepted_as_is",
    });
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return {
    error: skipped > 0 ? `${inserted.length} row(s) added. ${skipReason}` : null,
    addedCount: inserted.length,
  };
}

export interface ExtractMaterialRowsState {
  error: string | null;
  rows: ExtractedMaterialRow[];
  aiLogId: string | null;
}

const EMPTY_EXTRACT_MATERIAL_STATE: ExtractMaterialRowsState = { error: null, rows: [], aiLogId: null };

export async function extractMaterialRowsAction(
  _prev: ExtractMaterialRowsState,
  formData: FormData
): Promise<ExtractMaterialRowsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const sourceText = String(formData.get("source_text") ?? "").trim().slice(0, 200_000);

  if (!projectId || !sourceText) {
    return { ...EMPTY_EXTRACT_MATERIAL_STATE, error: "Select a project and provide some submittal/certificate text to extract from." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_EXTRACT_MATERIAL_STATE, error: "Project not found, or you don't have access to it." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_EXTRACT_MATERIAL_STATE, error: gate.reason };

  try {
    const inputHash = hashAiCacheInput(sourceText);
    const cached = await findCachedAiResponse<ExtractedMaterialRow[]>(supabase, {
      organizationId: project.organization_id,
      feature: "material_register_extraction",
      promptVersion: PROMPT_VERSIONS.material_register_extraction,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let rows: ExtractedMaterialRow[];
    if (cached) {
      rows = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.extractMaterialRows({ sourceText }));
      rows = captured.result;
      usage = captured.usage;
    }
    if (rows.length === 0) {
      return { ...EMPTY_EXTRACT_MATERIAL_STATE, error: "No material entries could be identified in that text." };
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId,
      userId: user?.id ?? null,
      feature: "material_register_extraction",
      modelId: getGeminiModel("material_register_extraction"),
      promptVersion: PROMPT_VERSIONS.material_register_extraction,
      sourceRef: { projectId, sourceTextLength: sourceText.length },
      aiResponse: rows,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, rows, aiLogId: logId };
  } catch (err) {
    return {
      ...EMPTY_EXTRACT_MATERIAL_STATE,
      error: aiErrorMessage(err, "Could not extract material entries from that text."),
    };
  }
}

export async function addExtractedMaterialRowsAction(
  _prev: AddExtractedRowsState,
  formData: FormData
): Promise<AddExtractedRowsState> {
  const projectId = String(formData.get("project_id") ?? "").trim();
  const rowsJson = String(formData.get("rows_json") ?? "");
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;

  if (!projectId || !rowsJson) return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Missing project or rows to add." };

  let rows: ExtractedMaterialRow[];
  try {
    rows = JSON.parse(rowsJson) as ExtractedMaterialRow[];
  } catch {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "The extracted rows could not be read — please re-extract." };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ...EMPTY_ADD_EXTRACTED_STATE, error: "No rows to add." };

  const supabase = await createSupabaseServerClient();
  const writer = await requireRegisterContributor(supabase, projectId);
  if (writer.error) return { ...EMPTY_ADD_EXTRACTED_STATE, error: writer.error };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const insertable: ExtractedMaterialRow[] = [];
  const reasons = { missing: 0, invalid: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    const desc = r.materialDescription?.trim();
    if (!desc) { reasons.missing++; continue; }
    const heat = r.heatNumber?.trim();
    if (heat) {
      const key = `${heat.toLowerCase()}|${desc.toLowerCase()}`;
      if (seen.has(key) || (await entryExists(supabase, MATERIAL_REGISTER_TABLE, projectId, { heat_number: heat, material_description: desc }))) {
        reasons.duplicate++;
        continue;
      }
      seen.add(key);
    }
    insertable.push({ ...r, materialDescription: desc, heatNumber: heat || null });
  }
  const skipped = reasons.missing + reasons.invalid + reasons.duplicate;
  const skipReason = extractedSkipMessage(skipped, reasons);

  if (insertable.length === 0) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: `No rows were added. ${skipReason}` };
  }
  const receiptStatus: MaterialReceiptStatus = writer.isStaff ? "quarantined_pending_disposition" : "received_pending_inspection";

  // Deliberately no approval_status/receipt_status here — extraction never sets a release
  // judgement (per the sample pack's own rule: "AI extraction does not set release; authorized
  // inspection/approval does"). Landing every row as approval_status 'A' + receipt_status
  // 'released' would silently grant use. Instead default to the most conservative state
  // (quarantined pending disposition) so the document controller must actively release each one.
  const { data: inserted, error } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .insert(
      insertable.map((r) => ({
        project_id: projectId,
        material_description: r.materialDescription,
        submittal_reference: r.submittalReference || null,
        approval_status: "C" as const, // "Revise and resubmit" — the least-committal existing code; not yet reviewed
        heat_number: r.heatNumber || null,
        batch_number: r.batchNumber || null,
        po_reference: r.poReference || null,
        certificate_reference: r.certificateReference || null,
        receipt_status: receiptStatus,
        disposition_notes: "AI-extracted — pending document-controller review against the source certificate.",
      }))
    )
    .select("id");

  if (error || !inserted) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Could not add the extracted rows. Check you have permission and try again." };
  }

  for (const row of inserted as unknown as { id: string }[]) {
    await auditRegisterEntry(supabase, {
      projectId,
      entityType: "material_register_entry",
      entityId: row.id,
      action: "ai_extracted_added",
      summary: `AI-extracted material entry added${skipped > 0 ? ` (batch of ${inserted.length} added, ${skipped} skipped)` : ""}`,
    });
  }

  if (aiLogId && user?.id) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: user.id,
      targetType: "material_register_batch",
      targetId: projectId,
      reviewedResponse: { addedRows: insertable, skippedCount: skipped },
      decision: skipped > 0 || JSON.stringify(insertable) !== JSON.stringify(rows) ? "edited_and_accepted" : "accepted_as_is",
    });
  }

  revalidatePath(`/inspect/projects/${projectId}/registers`);
  return {
    error: skipped > 0 ? `${inserted.length} row(s) added. ${skipReason}` : null,
    addedCount: inserted.length,
  };
}
