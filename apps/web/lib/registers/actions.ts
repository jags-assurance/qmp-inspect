"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";
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
  const { data: entry, error } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .insert({
      project_id: projectId,
      instrument_name: instrumentName,
      cert_number: certNumber,
      cal_date: calDate || null,
      due_date: dueDate,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

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
  const qualifiedWps = String(formData.get("qualified_wps") ?? "").trim();
  const qualifiedRanges = String(formData.get("qualified_ranges") ?? "").trim();
  const expiryDate = String(formData.get("expiry_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!projectId || !welderIdentifier || !qualifiedWps || !expiryDate) {
    return { error: "Welder identifier, qualified WPS, and expiry date are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: entry, error } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .insert({
      project_id: projectId,
      welder_identifier: welderIdentifier,
      qualified_wps: qualifiedWps,
      qualified_ranges: qualifiedRanges || null,
      expiry_date: expiryDate,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

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
  const { data: entry, error } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .insert({
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
    })
    .select("id")
    .single<{ id: string }>();

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

  const supabase = await createSupabaseServerClient();
  const { data: entry, error } = await supabase
    .from(PERSONNEL_CERTIFICATIONS_TABLE)
    .insert({
      project_id: projectId,
      project_party_id: projectPartyId,
      certification_type: certificationType,
      cert_number: certNumber || null,
      issued_date: issuedDate || null,
      expiry_date: expiryDate,
      notes: notes || null,
    })
    .select("id")
    .single<{ id: string }>();

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
  const sourceText = String(formData.get("source_text") ?? "").trim();

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
      error: err instanceof Error ? err.message : "Could not extract calibration entries from that text.",
    };
  }
}

export interface AddExtractedRowsState {
  error: string | null;
  addedCount: number;
}

const EMPTY_ADD_EXTRACTED_STATE: AddExtractedRowsState = { error: null, addedCount: 0 };

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // due_date is not-null on calibration_register (its own manual-add form requires it too) — a row
  // extracted with no due date is real, protective behavior (per the sample pack: a missing due
  // date must block use, never be inferred), but it can't be inserted as-is. Skip such rows rather
  // than either failing the whole batch or inventing a date; the document controller is told which
  // ones were skipped so they can chase the real certificate before adding it by hand.
  const insertable = rows.filter((r) => r.instrumentName?.trim() && r.certNumber?.trim() && r.dueDate?.trim());
  const skipped = rows.length - insertable.length;

  if (insertable.length === 0) {
    return {
      ...EMPTY_ADD_EXTRACTED_STATE,
      error: "None of the extracted rows had every required field (instrument, certificate number, due date) — add them manually once the missing details are confirmed.",
    };
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
      }))
    )
    .select("id");

  if (error || !inserted) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Could not add the extracted rows. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "calibration_register_entry",
    entityId: projectId,
    action: "ai_extracted_batch_added",
    summary: `${inserted.length} AI-extracted calibration entries added${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
  });

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
    error: skipped > 0 ? `${skipped} row(s) were skipped — missing a required field (instrument, cert number, or due date).` : null,
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
  const sourceText = String(formData.get("source_text") ?? "").trim();

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
      error: err instanceof Error ? err.message : "Could not extract welder entries from that text.",
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // expiry_date is not-null on welder_qualification_register — same reasoning as the calibration
  // batch above: skip a row missing it rather than inventing one.
  const insertable = rows.filter((r) => r.welderIdentifier?.trim() && r.expiryDate?.trim());
  const skipped = rows.length - insertable.length;

  if (insertable.length === 0) {
    return {
      ...EMPTY_ADD_EXTRACTED_STATE,
      error: "None of the extracted rows had every required field (welder ID, expiry date) — add them manually once confirmed.",
    };
  }

  const { data: inserted, error } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .insert(
      insertable.map((r) => ({
        project_id: projectId,
        welder_identifier: r.welderIdentifier,
        qualified_wps: r.qualifiedWps || "Not confirmed in source",
        qualified_ranges: r.qualifiedRanges || null,
        expiry_date: r.expiryDate,
      }))
    )
    .select("id");

  if (error || !inserted) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Could not add the extracted rows. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "welder_qualification_entry",
    entityId: projectId,
    action: "ai_extracted_batch_added",
    summary: `${inserted.length} AI-extracted welder qualification entries added${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
  });

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
    error: skipped > 0 ? `${skipped} row(s) were skipped — missing a required field (welder ID or expiry date).` : null,
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
  const sourceText = String(formData.get("source_text") ?? "").trim();

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
      error: err instanceof Error ? err.message : "Could not extract material entries from that text.",
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

  const insertable = rows.filter((r) => r.materialDescription?.trim());
  const skipped = rows.length - insertable.length;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
        receipt_status: "quarantined_pending_disposition" as const,
        disposition_notes: "AI-extracted — pending document-controller review against the source certificate.",
      }))
    )
    .select("id");

  if (error || !inserted) {
    return { ...EMPTY_ADD_EXTRACTED_STATE, error: "Could not add the extracted rows. Check you have permission and try again." };
  }

  await auditRegisterEntry(supabase, {
    projectId,
    entityType: "material_register_entry",
    entityId: projectId,
    action: "ai_extracted_batch_added",
    summary: `${inserted.length} AI-extracted material entries added${skipped > 0 ? ` (${skipped} skipped)` : ""}`,
  });

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
    error: skipped > 0 ? `${skipped} row(s) had no material description and were skipped.` : null,
    addedCount: inserted.length,
  };
}
