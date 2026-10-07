import type { SupabaseClient } from "@supabase/supabase-js";
import { checkPersonnelCertification, checkRegisterVerification, fetchLinkedRegisterRow, fetchRequiredRegisters } from "./verify";
import { isRegisterRowActive, isRegisterRowVerified } from "./lifecycle";
import { computeCalibrationStatus, computeWelderStatus, todayInTimeZone } from "./status";

// The register soft-stop used to be enforced only in the browser. This is the server-side half: it
// recomputes the verification when a response is saved, refuses a "Yes" that needs an override reason
// without one, and hands back the structured record to persist next to the answer.

export const OVERRIDE_PREFIX = "[Register override] ";

/** Longest a captured-at timestamp may lag behind the save (an offline inspection synced days later). */
export const MAX_CAPTURE_LAG_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The time an answer was actually given. The browser sends it (and carries it through the offline
 * queue); it is only trusted within [now - 30 days, now + 5 min], otherwise the save time is used.
 */
export function boundCapturedAt(raw: string | null | undefined, now: Date = new Date()): Date {
  if (!raw) return now;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return now;
  if (t > now.getTime() + 5 * 60 * 1000) return now;
  if (t < now.getTime() - MAX_CAPTURE_LAG_MS) return now;
  return new Date(Math.min(t, now.getTime()));
}

/** The override reason: the dedicated form field when sent, else the legacy "[Register override] " comment prefix. */
export function extractOverrideReason(field: string | null | undefined, comment: string): string {
  const direct = (field ?? "").trim();
  if (direct) return direct.slice(0, 500);
  if (!comment.startsWith(OVERRIDE_PREFIX)) return "";
  const rest = comment.slice(OVERRIDE_PREFIX.length);
  const newline = rest.indexOf("\n");
  return (newline === -1 ? rest : rest.slice(0, newline)).trim().slice(0, 500);
}

export interface RegisterGateInput {
  projectId: string;
  itpItemId: string;
  userId: string | null;
  result: "yes" | "no" | "na";
  comment: string;
  overrideReasonField: string | null;
  capturedAtRaw: string | null;
  calibrationAssetId: string;
  materialId: string;
  welderId: string;
}

export interface RegisterGateOutcome {
  error: string | null;
  overrideReason: string | null;
  /** Structured record of what the register check said at the time (null when no register applied). */
  registerCheck: Record<string, unknown> | null;
  capturedAt: string;
}

let responseColumnsKnownPresent = false;
let responseColumnsCheckedAt = 0;

/**
 * override_reason / register_check_result / captured_at on checklist_responses, or {} when the database
 * doesn't have them yet (migration 20261103000100) so the save keeps working before it is applied.
 */
export async function structuredResponseColumns(
  supabase: SupabaseClient,
  gate: Pick<RegisterGateOutcome, "overrideReason" | "registerCheck" | "capturedAt">
): Promise<Record<string, unknown>> {
  if (!responseColumnsKnownPresent && Date.now() - responseColumnsCheckedAt > 5 * 60 * 1000) {
    responseColumnsCheckedAt = Date.now();
    const { error } = await supabase.from("checklist_responses").select("override_reason, register_check_result, captured_at" as never).limit(1);
    responseColumnsKnownPresent = !error;
  }
  if (!responseColumnsKnownPresent) return {};
  return { override_reason: gate.overrideReason, register_check_result: gate.registerCheck, captured_at: gate.capturedAt };
}

export async function projectTimezone(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await supabase.from("projects").select("timezone" as never).eq("id", projectId).maybeSingle<{ timezone: string | null }>();
  return error ? null : (data?.timezone ?? null);
}

/**
 * Validates the register rows an answer is linked to (in date on the inspection day, verified, active,
 * released) and recomputes the soft-stop. Returns an error string to refuse the save, or the values to persist.
 */
export async function evaluateRegisterGate(supabase: SupabaseClient, input: RegisterGateInput): Promise<RegisterGateOutcome> {
  const capturedAt = boundCapturedAt(input.capturedAtRaw);
  const today = todayInTimeZone(await projectTimezone(supabase, input.projectId), capturedAt);
  const fail = (error: string): RegisterGateOutcome => ({ error, overrideReason: null, registerCheck: null, capturedAt: capturedAt.toISOString() });

  // Traceability links must point at an ACTIVE, VERIFIED row on THIS project; calibration/welder must
  // also be in date ON THE INSPECTION DAY (not on the day the answer synced), and material released.
  if (input.calibrationAssetId) {
    const row = await fetchLinkedRegisterRow(supabase, "calibration", input.projectId, input.calibrationAssetId);
    if (!row) return fail("The selected instrument does not belong to this project.");
    if (!isRegisterRowActive(row)) return fail("The selected instrument has been superseded or retired — choose the current instrument.");
    if (!isRegisterRowVerified(row)) return fail("The selected instrument has not been verified by JAGS staff yet.");
    if (row.due_date && computeCalibrationStatus(row.due_date, today) === "expired") {
      return fail("The selected instrument's calibration had expired on the inspection date — choose an in-date instrument.");
    }
  }
  if (input.welderId) {
    const row = await fetchLinkedRegisterRow(supabase, "welder", input.projectId, input.welderId);
    if (!row) return fail("The selected welder does not belong to this project.");
    if (!isRegisterRowActive(row)) return fail("The selected welder qualification has been withdrawn or retired — choose a qualified welder.");
    if (!isRegisterRowVerified(row)) return fail("The selected welder qualification has not been verified by JAGS staff yet.");
    if (row.expiry_date && computeWelderStatus(row.expiry_date, today) === "expired") {
      return fail("The selected welder's qualification had expired on the inspection date — choose a qualified welder.");
    }
  }
  if (input.materialId) {
    const row = await fetchLinkedRegisterRow(supabase, "material", input.projectId, input.materialId);
    if (!row) return fail("The selected material does not belong to this project.");
    if (!isRegisterRowActive(row)) return fail("The selected material has been retired or withdrawn.");
    if (!isRegisterRowVerified(row)) return fail("The selected material has not been verified by JAGS staff yet.");
    if (row.receipt_status !== "released") return fail("The selected material has not been released at receiving inspection.");
  }

  // Soft-stop: recompute server-side. Needs the activity's text and the executing party.
  const { data: item } = await supabase
    .from("itp_items")
    .select("reference_spec, acceptance_criteria")
    .eq("id", input.itpItemId)
    .maybeSingle<{ reference_spec: string | null; acceptance_criteria: string | null }>();
  if (!item) return { error: null, overrideReason: extractOverrideReason(input.overrideReasonField, input.comment) || null, registerCheck: null, capturedAt: capturedAt.toISOString() };

  const required = await fetchRequiredRegisters(supabase, input.itpItemId);
  let partyId: string | null = null;
  if (input.userId) {
    const { data: parties } = await supabase
      .from("activity_party_intervention")
      .select("project_parties(id, user_id, is_active)")
      .eq("itp_item_id", input.itpItemId)
      .returns<{ project_parties: { id: string; user_id: string | null; is_active: boolean } | null }[]>();
    partyId = (parties ?? []).find((p) => p.project_parties?.user_id === input.userId && p.project_parties.is_active)?.project_parties?.id ?? null;
  }

  const [registerCheck, personnelCheck] = await Promise.all([
    checkRegisterVerification(supabase, {
      projectId: input.projectId,
      itpItemReferenceSpec: item.reference_spec,
      itpItemAcceptanceCriteria: item.acceptance_criteria,
      selected: {
        calibrationAssetId: input.calibrationAssetId || null,
        materialId: input.materialId || null,
        welderId: input.welderId || null,
      },
      requiredRegisters: required,
      today,
    }),
    checkPersonnelCertification(supabase, {
      projectId: input.projectId,
      executingProjectPartyId: partyId,
      executingUserId: input.userId,
      itpItemReferenceSpec: item.reference_spec,
      itpItemAcceptanceCriteria: item.acceptance_criteria,
      requiredRegisters: required,
      today,
    }),
  ]);

  const needsOverride = !!(registerCheck?.requiresOverrideReason || personnelCheck?.requiresOverrideReason);
  const reason = extractOverrideReason(input.overrideReasonField, input.comment);
  if (needsOverride && input.result === "yes" && !reason) {
    const why = (registerCheck?.requiresOverrideReason ? registerCheck : personnelCheck)?.message.split(" This does not block")[0] ?? "A register check failed.";
    return fail(`A reason is required before recording Yes: ${why}`);
  }

  const record =
    registerCheck || personnelCheck
      ? {
          asOf: today.toISOString().slice(0, 10),
          register: registerCheck ? { kind: registerCheck.kind ?? null, tone: registerCheck.tone, message: registerCheck.message, needsOverride: registerCheck.requiresOverrideReason } : null,
          personnel: personnelCheck ? { tone: personnelCheck.tone, message: personnelCheck.message, needsOverride: personnelCheck.requiresOverrideReason } : null,
        }
      : null;
  return { error: null, overrideReason: needsOverride && reason ? reason : null, registerCheck: record, capturedAt: capturedAt.toISOString() };
}
