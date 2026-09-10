import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_APPROVAL_STATUS_LABELS,
  MATERIAL_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
  type CalibrationRegisterRow,
  type MaterialRegisterRow,
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
      message: "Calibration record not found for this project (Calibration Register). This does not block the inspection.",
      requiresOverrideReason: true,
    };
  }

  if (entry.status === "expired") {
    return {
      tone: "warning",
      message: `Calibration expired — ${entry.instrument_name} (cert ${entry.cert_number}) was due ${entry.due_date} (Calibration Register). This does not block the inspection.`,
      requiresOverrideReason: true,
    };
  }

  return {
    tone: "info",
    message: `Calibration current — ${entry.instrument_name} (cert ${entry.cert_number}), due ${entry.due_date} (Calibration Register).`,
    requiresOverrideReason: false,
  };
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
      message: "Welder qualification record not found for this project (Welder Qualification Register). This does not block the inspection.",
      requiresOverrideReason: true,
    };
  }

  if (entry.status === "expired") {
    return {
      tone: "warning",
      message: `Welder qualification expired — ${entry.welder_identifier} on ${entry.qualified_wps} expired ${entry.expiry_date} (Welder Qualification Register). This does not block the inspection.`,
      requiresOverrideReason: true,
    };
  }

  return {
    tone: "info",
    message: `Welder qualified — ${entry.welder_identifier} on ${entry.qualified_wps}, expires ${entry.expiry_date} (Welder Qualification Register).`,
    requiresOverrideReason: false,
  };
}

async function checkMaterial(supabase: SupabaseClient, projectId: string): Promise<RegisterVerificationResult> {
  const { data } = await supabase
    .from(MATERIAL_REGISTER_TABLE)
    .select("material_description, submittal_reference, approval_status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<Pick<MaterialRegisterRow, "material_description" | "submittal_reference" | "approval_status">[]>();

  const entry = data?.[0];
  if (!entry) {
    return {
      tone: "warning",
      message: "Material approval record not found for this project (Material Register). This does not block the inspection.",
      requiresOverrideReason: true,
    };
  }

  const refSuffix = entry.submittal_reference ? ` — submittal ref ${entry.submittal_reference}` : "";
  const label = MATERIAL_APPROVAL_STATUS_LABELS[entry.approval_status];

  if (entry.approval_status === "C" || entry.approval_status === "D") {
    return {
      tone: "warning",
      message: `Material not approved for use — ${entry.material_description}${refSuffix}: ${label} (Material Register). This does not block the inspection.`,
      requiresOverrideReason: true,
    };
  }

  return {
    tone: "info",
    message: `Material approved${refSuffix} — ${entry.material_description}: ${label} (Material Register).`,
    requiresOverrideReason: false,
  };
}
