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

/**
 * Simple keyword-based heuristic (R92-R100): looks at an ITP activity's reference_spec/
 * acceptance_criteria text for words suggesting it's checking something a register tracks, and if
 * so, looks up the most relevant register row for this project and summarises it. This is meant as
 * an assist for the inspector, not a hard classifier — most activities won't match anything and
 * this returns null for them, unchanged from today's plain Yes/No/N-A flow.
 *
 * Matching is intentionally coarse (case-insensitive substring checks) rather than NLP/exact
 * cross-referencing to a specific register row by instrument/welder/material name, since the ITP
 * text and register entries are free text maintained separately and won't reliably share an exact
 * identifier — this checks "does *any* register entry of the relevant kind look current for this
 * project" and lets the inspector confirm or override the specific one that applies.
 */
export async function checkRegisterVerification(
  supabase: SupabaseClient,
  params: { projectId: string; itpItemReferenceSpec: string | null; itpItemAcceptanceCriteria: string | null }
): Promise<RegisterVerificationResult | null> {
  const haystack = `${params.itpItemReferenceSpec ?? ""} ${params.itpItemAcceptanceCriteria ?? ""}`.toLowerCase();

  const mentionsCalibration = haystack.includes("calibrat");
  const mentionsWelder = haystack.includes("weld");
  const mentionsMaterial = haystack.includes("material") || haystack.includes("submittal");

  if (mentionsCalibration) return checkCalibration(supabase, params.projectId);
  if (mentionsWelder) return checkWelder(supabase, params.projectId);
  if (mentionsMaterial) return checkMaterial(supabase, params.projectId);
  return null;
}

async function checkCalibration(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .select("instrument_name, cert_number, due_date, status")
    .eq("project_id", projectId)
    .order("due_date", { ascending: true })
    .limit(1)
    .returns<Pick<CalibrationRegisterRow, "instrument_name" | "cert_number" | "due_date" | "status">[]>();

  const entry = data?.[0];
  if (!entry) {
    return {
      tone: "warning",
      message: "Calibration record not found for this project (Calibration Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.",
      requiresOverrideReason: true,
      kind: "calibration",
    };
  }

  if (entry.status === "expired") {
    return {
      tone: "warning",
      message: `Calibration expired — ${entry.instrument_name} (cert ${entry.cert_number}) was due ${entry.due_date} (Calibration Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.`,
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

/** All calibration-register rows for a project, for the "which instrument did you use" picker shown
 *  alongside a calibration-kind registerVerification — see checkCalibration above and
 *  response-row.tsx. A separate query rather than folding into checkCalibration's own result
 *  because that function intentionally only surfaces the ONE most-relevant row as an assist message,
 *  while the picker needs every candidate instrument the inspector might have actually used. */
export async function listCalibrationOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<Pick<CalibrationRegisterRow, "id" | "instrument_name" | "cert_number" | "status">[]> {
  const { data } = await supabase
    .from(CALIBRATION_REGISTER_TABLE)
    .select("id, instrument_name, cert_number, status")
    .eq("project_id", projectId)
    .order("instrument_name")
    .returns<Pick<CalibrationRegisterRow, "id" | "instrument_name" | "cert_number" | "status">[]>();
  return data ?? [];
}

async function checkWelder(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(WELDER_QUALIFICATION_REGISTER_TABLE)
    .select("welder_identifier, qualified_wps, expiry_date, status")
    .eq("project_id", projectId)
    .order("expiry_date", { ascending: true })
    .limit(1)
    .returns<Pick<WelderQualificationRegisterRow, "welder_identifier" | "qualified_wps" | "expiry_date" | "status">[]>();

  const entry = data?.[0];
  if (!entry) {
    return {
      tone: "warning",
      message: "Welder qualification record not found for this project (Welder Qualification Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.",
      requiresOverrideReason: true,
      kind: "welder",
    };
  }

  if (entry.status === "expired") {
    return {
      tone: "warning",
      message: `Welder qualification expired — ${entry.welder_identifier} on ${entry.qualified_wps} expired ${entry.expiry_date} (Welder Qualification Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.`,
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

async function checkMaterial(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .select("material_description, submittal_reference, approval_status, receipt_status, disposition_notes")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<
      Pick<
        MaterialRegisterRow,
        "material_description" | "submittal_reference" | "approval_status" | "receipt_status" | "disposition_notes"
      >[]
    >();

  const entry = data?.[0];
  if (!entry) {
    return {
      tone: "warning",
      message: "Material approval record not found for this project (Material Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.",
      requiresOverrideReason: true,
      kind: "material",
    };
  }

  const refSuffix = entry.submittal_reference ? ` — submittal ref ${entry.submittal_reference}` : "";
  const label = MATERIAL_APPROVAL_STATUS_LABELS[entry.approval_status];

  if (entry.approval_status === "C" || entry.approval_status === "D") {
    return {
      tone: "warning",
      message: `Material not approved for use — ${entry.material_description}${refSuffix}: ${label} (Material Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.`,
      requiresOverrideReason: true,
      kind: "material",
    };
  }

  // Receiving-inspection gate, separate from (and checked in addition to) the design-review
  // approval above: an approved material can still be sitting quarantined/on hold because it
  // arrived damaged, unidentified, or without its certificate (material_register.receipt_status,
  // 20260920010000_material_traceability_and_tool_linkage.sql).
  if (entry.receipt_status !== "released") {
    const receiptLabel = MATERIAL_RECEIPT_STATUS_LABELS[entry.receipt_status];
    return {
      tone: "warning",
      message: `Material ${receiptLabel.toLowerCase()} at receiving inspection — ${entry.material_description}${refSuffix}${
        entry.disposition_notes ? `: ${entry.disposition_notes}` : ""
      } (Material Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.`,
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
 * checkRegisterVerification above): the calibration/welder/material checks confirm a register entry
 * of the right kind exists for the PROJECT, but never confirmed the PERSON about to record the
 * response actually holds a current certification for that kind of work. This mirrors that pattern
 * one level down — same coarse keyword match, same warning-tone/override-reason shape, same "assist,
 * not a classifier" caveat — scoped to the one project_party executing this checklist.
 *
 * executingProjectPartyId is the resolved project_parties.id for the current signed-in user on this
 * activity (see page.tsx: the same activity_party_intervention lookup that already decides who CAN
 * execute the checklist). It's null when the current user isn't linked to a project_party here at
 * all — e.g. JAGS staff running the inspection directly — in which case there's no personnel_
 * certifications row to check against and this returns null, same as "not applicable."
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
    .select("certification_type, cert_number, expiry_date, status")
    .eq("project_id", params.projectId)
    .eq("project_party_id", params.executingProjectPartyId)
    .order("expiry_date", { ascending: true })
    .returns<Pick<PersonnelCertificationRow, "certification_type" | "cert_number" | "expiry_date" | "status">[]>();

  const candidates = (data ?? []).filter((row) =>
    match.certKeywords.some((kw) => row.certification_type.toLowerCase().includes(kw))
  );
  const entry = candidates[0];

  if (!entry) {
    return {
      tone: "warning",
      message:
        "Personnel certification record not found for this person for this type of activity (Personnel Certification Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.",
      requiresOverrideReason: true,
    };
  }

  if (entry.status === "expired") {
    return {
      tone: "warning",
      message: `Personnel certification expired — ${entry.certification_type}${entry.cert_number ? ` (cert ${entry.cert_number})` : ""} was due ${entry.expiry_date} (Personnel Certification Register). This does not block the inspection, but you must type a reason above before Yes/No/N-A become clickable.`,
      requiresOverrideReason: true,
    };
  }

  return {
    tone: "info",
    message: `Personnel certification current — ${entry.certification_type}${entry.cert_number ? ` (cert ${entry.cert_number})` : ""}, expires ${entry.expiry_date} (Personnel Certification Register).`,
    requiresOverrideReason: false,
  };
}
