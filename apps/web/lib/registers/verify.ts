import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_APPROVAL_STATUS_LABELS,
  MATERIAL_RECEIPT_STATUS_LABELS,
  MATERIAL_REGISTER_TABLE,
  PERSONNEL_CERTIFICATIONS_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  type CalibrationRegisterRow,
  type MaterialRegisterRow,
  type PersonnelCertificationRow,
  type WelderQualificationRegisterRow,
} from "./types";
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus } from "./status";

export type RegisterVerificationTone = "info" | "warning";

export interface RegisterVerificationResult {
  tone: RegisterVerificationTone;
  /** e.g. "Material approved — submittal ref X (Material Register)" or a not-found warning. */
  message: string;
  /**
   * R99: register mismatches are a soft-stop, never a hard block — a warning result requires the
   * inspector to type a short override reason before recording a response, but the response is
   * always allowed through once that reason is given.
   */
  requiresOverrideReason: boolean;
  /** Lets the UI offer a "which instrument did you use" picker only for a calibration-kind check —
   *  see checklist-execution-panel.tsx / response-row.tsx. Omitted for welder/material checks. */
  kind?: "calibration" | "welder" | "material";
}

const SOFT_STOP_SUFFIX =
  "This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.";

/** Row ids the inspector explicitly picked; a chosen row is checked instead of "any row on the project". */
export interface SelectedRegisterRows {
  calibrationAssetId?: string | null;
  materialId?: string | null;
  welderId?: string | null;
}

/**
 * Simple keyword-based heuristic (R92-R100): looks at an ITP activity's reference_spec/
 * acceptance_criteria text for words suggesting it's checking something a register tracks, and if
 * so, looks up a relevant register row for this project and summarises it. This is meant as
 * an assist for the inspector, not a hard classifier — most activities won't match anything and
 * this returns null for them, unchanged from today's plain Yes/No/N-A flow.
 *
 * Without a chosen row this checks "does *any* register entry of the relevant kind look current for
 * this project"; when the inspector has picked a specific row (selected) that exact row is checked.
 */
export async function checkRegisterVerification(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    itpItemReferenceSpec: string | null;
    itpItemAcceptanceCriteria: string | null;
    selected?: SelectedRegisterRows;
  }
): Promise<RegisterVerificationResult | null> {
  const haystack = `${params.itpItemReferenceSpec ?? ""} ${params.itpItemAcceptanceCriteria ?? ""}`.toLowerCase();

  const mentionsCalibration = haystack.includes("calibrat");
  const mentionsWelder = haystack.includes("weld");
  const mentionsMaterial = haystack.includes("material") || haystack.includes("submittal");

  if (mentionsCalibration) {
    return params.selected?.calibrationAssetId
      ? verifyCalibrationAssetById(supabase, params.projectId, params.selected.calibrationAssetId)
      : checkCalibration(supabase, params.projectId);
  }
  if (mentionsWelder) {
    return params.selected?.welderId
      ? verifyWelderById(supabase, params.projectId, params.selected.welderId)
      : checkWelder(supabase, params.projectId);
  }
  if (mentionsMaterial) {
    return params.selected?.materialId
      ? verifyMaterialById(supabase, params.projectId, params.selected.materialId)
      : checkMaterial(supabase, params.projectId);
  }
  return null;
}

// ── Calibration ─────────────────────────────────────────────────────────────────────────────

type CalibrationEntry = Pick<CalibrationRegisterRow, "instrument_name" | "cert_number" | "due_date">;
const CALIBRATION_COLUMNS = "instrument_name, cert_number, due_date";

function calibrationResult(entry: CalibrationEntry | null | undefined): RegisterVerificationResult {
  if (!entry) {
    return {
      tone: "warning",
      message: `Calibration record not found for this project (Calibration Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "calibration",
    };
  }
  // Recomputed from the date, never the stored status, which goes stale between page visits.
  if (computeCalibrationStatus(entry.due_date) === "expired") {
    return {
      tone: "warning",
      message: `Calibration expired — ${entry.instrument_name} (cert ${entry.cert_number}) was due ${entry.due_date} (Calibration Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "calibration",
    };
  }
  return {
    tone: "info",
    message: `Calibration current — ${entry.instrument_name} (cert ${entry.cert_number}), due ${entry.due_date} (Calibration Register). Record which instrument you actually used below.`,
    requiresOverrideReason: false,
    kind: "calibration",
  };
}

async function checkCalibration(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .select(CALIBRATION_COLUMNS)
    .eq("project_id", projectId)
    .order("due_date", { ascending: false })
    .returns<CalibrationEntry[]>();
  const rows = data ?? [];
  // Any current instrument satisfies the coarse check; otherwise surface an expired one.
  const entry = rows.find((r) => computeCalibrationStatus(r.due_date) !== "expired") ?? rows[0];
  return calibrationResult(entry);
}

/** Checks the specific calibration-register row the inspector chose (must belong to the project). */
export async function verifyCalibrationAssetById(
  supabase: SupabaseClient,
  projectId: string,
  id: string
): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .select(CALIBRATION_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle<CalibrationEntry>();
  return calibrationResult(data);
}

/** All calibration-register rows for a project, for the "which instrument did you use" picker shown
 *  alongside a calibration-kind registerVerification — see response-row.tsx. A separate query
 *  because the picker needs every candidate instrument the inspector might have actually used. */
export async function listCalibrationOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; instrument_name: string; cert_number: string; status: string }[]> {
  const { data } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .select("id, instrument_name, cert_number, due_date")
    .eq("project_id", projectId)
    .order("instrument_name")
    .returns<Pick<CalibrationRegisterRow, "id" | "instrument_name" | "cert_number" | "due_date">[]>();
  return (data ?? []).map((r) => ({
    id: r.id,
    instrument_name: r.instrument_name,
    cert_number: r.cert_number,
    status: computeCalibrationStatus(r.due_date),
  }));
}

// ── Welder ──────────────────────────────────────────────────────────────────────────────────

type WelderEntry = Pick<WelderQualificationRegisterRow, "welder_identifier" | "qualified_wps" | "expiry_date">;
const WELDER_COLUMNS = "welder_identifier, qualified_wps, expiry_date";

function welderResult(entry: WelderEntry | null | undefined): RegisterVerificationResult {
  if (!entry) {
    return {
      tone: "warning",
      message: `Welder qualification record not found for this project (Welder Qualification Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "welder",
    };
  }
  if (computeWelderStatus(entry.expiry_date) === "expired") {
    return {
      tone: "warning",
      message: `Welder qualification expired — ${entry.welder_identifier} on ${entry.qualified_wps} expired ${entry.expiry_date} (Welder Qualification Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "welder",
    };
  }
  return {
    tone: "info",
    message: `Welder qualified — ${entry.welder_identifier} on ${entry.qualified_wps}, expires ${entry.expiry_date} (Welder Qualification Register).`,
    requiresOverrideReason: false,
    kind: "welder",
  };
}

async function checkWelder(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .select(WELDER_COLUMNS)
    .eq("project_id", projectId)
    .order("expiry_date", { ascending: false })
    .returns<WelderEntry[]>();
  const rows = data ?? [];
  const entry = rows.find((r) => computeWelderStatus(r.expiry_date) !== "expired") ?? rows[0];
  return welderResult(entry);
}

/** Checks the specific welder-register row the inspector chose (must belong to the project). */
export async function verifyWelderById(
  supabase: SupabaseClient,
  projectId: string,
  id: string
): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .select(WELDER_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle<WelderEntry>();
  return welderResult(data);
}

/** Welder rows for the "which welder" picker. */
export async function listWelderOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; welder_identifier: string; qualified_wps: string; status: string }[]> {
  const { data } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .select("id, welder_identifier, qualified_wps, expiry_date")
    .eq("project_id", projectId)
    .order("welder_identifier")
    .returns<Pick<WelderQualificationRegisterRow, "id" | "welder_identifier" | "qualified_wps" | "expiry_date">[]>();
  return (data ?? []).map((r) => ({
    id: r.id,
    welder_identifier: r.welder_identifier,
    qualified_wps: r.qualified_wps,
    status: computeWelderStatus(r.expiry_date),
  }));
}

// ── Material ────────────────────────────────────────────────────────────────────────────────

type MaterialEntry = Pick<
  MaterialRegisterRow,
  "material_description" | "submittal_reference" | "approval_status" | "receipt_status" | "disposition_notes"
>;
const MATERIAL_COLUMNS = "material_description, submittal_reference, approval_status, receipt_status, disposition_notes";

function materialResult(entry: MaterialEntry | null | undefined): RegisterVerificationResult {
  if (!entry) {
    return {
      tone: "warning",
      message: `Material approval record not found for this project (Material Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "material",
    };
  }

  const refSuffix = entry.submittal_reference ? ` — submittal ref ${entry.submittal_reference}` : "";
  const label = MATERIAL_APPROVAL_STATUS_LABELS[entry.approval_status];

  if (entry.approval_status === "C" || entry.approval_status === "D") {
    return {
      tone: "warning",
      message: `Material not approved for use — ${entry.material_description}${refSuffix}: ${label} (Material Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "material",
    };
  }

  // Receiving-inspection gate, separate from (and checked in addition to) the design-review
  // approval above: an approved material can still be sitting quarantined/on hold.
  if (entry.receipt_status !== "released") {
    const receiptLabel = MATERIAL_RECEIPT_STATUS_LABELS[entry.receipt_status];
    return {
      tone: "warning",
      message: `Material ${receiptLabel.toLowerCase()} at receiving inspection — ${entry.material_description}${refSuffix}${
        entry.disposition_notes ? `: ${entry.disposition_notes}` : ""
      } (Material Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "material",
    };
  }

  return {
    tone: "info",
    message: `Material approved${refSuffix} — ${entry.material_description}: ${label} (Material Register).`,
    requiresOverrideReason: false,
    kind: "material",
  };
}

function isUsableMaterial(m: MaterialEntry): boolean {
  return (m.approval_status === "A" || m.approval_status === "B") && m.receipt_status === "released";
}

async function checkMaterial(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .select(MATERIAL_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .returns<MaterialEntry[]>();
  const rows = data ?? [];
  const entry = rows.find(isUsableMaterial) ?? rows[0];
  return materialResult(entry);
}

/** Checks the specific material-register row the inspector chose (must belong to the project). */
export async function verifyMaterialById(
  supabase: SupabaseClient,
  projectId: string,
  id: string
): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .select(MATERIAL_COLUMNS)
    .eq("project_id", projectId)
    .eq("id", id)
    .maybeSingle<MaterialEntry>();
  return materialResult(data);
}

/** Released materials only, for the "material used (heat/batch)" picker. */
export async function listMaterialOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; material_description: string; heat_number: string | null; batch_number: string | null }[]> {
  const { data } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .select("id, material_description, heat_number, batch_number")
    .eq("project_id", projectId)
    .eq("receipt_status", "released")
    .order("material_description")
    .returns<{ id: string; material_description: string; heat_number: string | null; batch_number: string | null }[]>();
  return data ?? [];
}

// ── Personnel ───────────────────────────────────────────────────────────────────────────────

// Same coarse heuristic as checkRegisterVerification above, but mapping activity text to the kind of
// personal certification it plausibly requires (rather than to a register table). certification_type
// is free text (see types.ts), so the second half of the match is also a keyword check against it
// rather than an exact code lookup — "does some cert this person holds look like the right kind" is
// the same spirit as "does some register entry of the relevant kind look current" above.
const PERSONNEL_CERT_ACTIVITY_MATCHES: { activityKeywords: string[]; certKeywords: string[] }[] = [
  { activityKeywords: ["weld"], certKeywords: ["weld"] },
  {
    activityKeywords: ["ndt", "non-destruct", "nondestructive", "radiograph", "ultrasonic", "penetrant", "magnetic particle"],
    certKeywords: ["ndt", "nde", "asnt"],
  },
  { activityKeywords: ["electric"], certKeywords: ["electric"] },
];

/**
 * Personnel-certification soft-stop (round-table finding, same R92-R100 spirit as
 * checkRegisterVerification above): confirms the PERSON about to record the response actually holds
 * a current certification for that kind of work, scoped to the one project_party executing this
 * checklist.
 *
 * executingProjectPartyId is null when the current user isn't linked to a project_party here (e.g.
 * JAGS staff running the inspection directly) — then this returns null, same as "not applicable."
 */
export async function checkPersonnelCertification(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    executingProjectPartyId: string | null;
    itpItemReferenceSpec: string | null;
    itpItemAcceptanceCriteria: string | null;
  }
): Promise<RegisterVerificationResult | null> {
  if (!params.executingProjectPartyId) return null;

  const haystack = `${params.itpItemReferenceSpec ?? ""} ${params.itpItemAcceptanceCriteria ?? ""}`.toLowerCase();
  const match = PERSONNEL_CERT_ACTIVITY_MATCHES.find((m) => m.activityKeywords.some((kw) => haystack.includes(kw)));
  if (!match) return null;

  const { data } = await supabase
    .from(PERSONNEL_CERTIFICATIONS_TABLE)
    .select("certification_type, cert_number, expiry_date")
    .eq("project_id", params.projectId)
    .eq("project_party_id", params.executingProjectPartyId)
    .order("expiry_date", { ascending: false })
    .returns<Pick<PersonnelCertificationRow, "certification_type" | "cert_number" | "expiry_date">[]>();

  const candidates = (data ?? []).filter((row) =>
    match.certKeywords.some((kw) => row.certification_type.toLowerCase().includes(kw))
  );
  // Prefer a current certificate; fall back to the most recently expired one to report it.
  const entry = candidates.find((r) => computePersonnelCertificationStatus(r.expiry_date) !== "expired") ?? candidates[0];

  if (!entry) {
    return {
      tone: "warning",
      message: `Personnel certification record not found for this person for this type of activity (Personnel Certification Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
    };
  }

  if (computePersonnelCertificationStatus(entry.expiry_date) === "expired") {
    return {
      tone: "warning",
      message: `Personnel certification expired — ${entry.certification_type}${entry.cert_number ? ` (cert ${entry.cert_number})` : ""} was due ${entry.expiry_date} (Personnel Certification Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
    };
  }

  return {
    tone: "info",
    message: `Personnel certification current — ${entry.certification_type}${entry.cert_number ? ` (cert ${entry.cert_number})` : ""}, expires ${entry.expiry_date} (Personnel Certification Register).`,
    requiresOverrideReason: false,
  };
}
