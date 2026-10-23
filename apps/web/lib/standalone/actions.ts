"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { createPunchItemFromSource } from "@/lib/punch-list/actions";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { boundedCapturedAt } from "@/lib/offline/policy";
import { sanitizeClientKey } from "@/lib/offline/idempotency";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { nextSequenceNumber, NumberingError } from "@/lib/numbering/generate";
import { createNotification } from "@/lib/notifications/helpers";
import { recordAuditEvent } from "@/lib/audit/log";
import { normaliseLocation } from "@/lib/checklists/location";
import { getLocationPresetsForProject } from "@/lib/checklists/location-presets";
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { logAiUsage } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import type { StandaloneMeasurementSuggestion } from "@/lib/ai/provider";
import {
  STANDALONE_ASSIGNMENTS,
  STANDALONE_ASSIGNMENT_MEASUREMENTS,
  STANDALONE_ASSIGNMENT_PHOTOS,
  STANDALONE_ASSIGNMENT_PUNCH_ITEMS,
  STANDALONE_ASSIGNMENT_SIGNATURES,
  STANDALONE_ASSIGNMENT_EVIDENCE_DOCUMENTS,
} from "./types";

const STAFF_ONLY_ERROR = "Only JAGS staff, or someone granted this permission, can run a standalone assignment.";

type Session = Awaited<ReturnType<typeof requireSession>>;
type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Three ways in, mirroring the same "who may actually run field work" model as ITP execution
 * (canExecuteItpItem, lib/checklists/execution-parties.ts):
 *
 * 1. JAGS staff — always.
 * 2. The "Full Client-Managed" tier's 3rd self-service permission (see
 *    CLIENT_MANAGED_ONLY_PERMISSION_KEYS, lib/rbac/types.ts): a client_managed org can grant
 *    run_standalone_assignment to its own people. Never available on any other tier.
 * 3. A subcontractor/main_contractor party actually active on THIS project, when a JAGS Admin has
 *    opted this specific project into projects.allow_contractor_standalone_assignment — the same
 *    tier-independent, per-project pattern as allow_contractor_itp_creation. Real-world basis: the
 *    subcontractor who supplied/installed the equipment is routinely the one running its FAT or
 *    pre-shipment check, on ANY engagement tier, not just a client_managed one.
 */
export async function canRunStandaloneAssignment(session: Session, supabase: SupabaseClient, projectId: string): Promise<boolean> {
  if (session.isJagsStaff) return true;
  if (await hasPermission(session.userId, "run_standalone_assignment", projectId)) return true;

  const { data: project } = await supabase
    .from("projects")
    .select("allow_contractor_standalone_assignment")
    .eq("id", projectId)
    .maybeSingle<{ allow_contractor_standalone_assignment: boolean }>();
  if (!project?.allow_contractor_standalone_assignment) return false;

  const { count } = await supabase
    .from("project_parties")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("user_id", session.userId)
    .eq("is_active", true)
    .in("party_type", ["subcontractor", "main_contractor"]);

  return !!count;
}

/**
 * Most mutations here only carry an assignment_id, not a project_id — this resolves the project
 * once so canRunStandaloneAssignment can be checked, reused by every action below instead of each
 * one hand-rolling its own lookup.
 */
async function requireStandaloneAccess(
  session: Session,
  supabase: SupabaseClient,
  assignmentId: string,
  opts: { requireDraft?: boolean; requireOpen?: boolean; blockCompleted?: boolean } = {}
): Promise<{ error: string | null; projectId: string | null }> {
  const { data } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("project_id, status")
    .eq("id", assignmentId)
    .maybeSingle<{ project_id: string; status: string }>();
  if (!data) return { error: "Assignment not found.", projectId: null };
  if (opts.requireDraft && data.status !== "draft") {
    return { error: "This assignment is finalized and locked. Records can no longer be added or changed.", projectId: data.project_id };
  }
  if (opts.requireOpen && data.status !== "draft" && data.status !== "conditional_open") {
    return { error: "This assignment is completed and locked. Records can no longer be added or changed.", projectId: data.project_id };
  }
  if (opts.blockCompleted && data.status === "completed") {
    return { error: "This assignment is completed and locked.", projectId: data.project_id };
  }
  if (!(await canRunStandaloneAssignment(session, supabase, data.project_id))) {
    return { error: STAFF_ONLY_ERROR, projectId: data.project_id };
  }
  return { error: null, projectId: data.project_id };
}

/** Best-effort fan-out to the creator and every active party on the project (except the actor) -
 *  never throws, never blocks the action that triggered it. */
async function notifyAssignmentParties(
  supabase: SupabaseClient,
  params: { projectId: string; assignmentId: string; actorId: string; extraUserIds?: (string | null)[]; title: string; body: string }
): Promise<void> {
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", params.projectId)
      .maybeSingle<{ organization_id: string }>();
    if (!project?.organization_id) return;
    const { data: parties } = await supabase
      .from("project_parties")
      .select("user_id")
      .eq("project_id", params.projectId)
      .eq("is_active", true)
      .returns<{ user_id: string | null }[]>();
    const recipients = new Set<string>();
    for (const id of [...(params.extraUserIds ?? []), ...(parties ?? []).map((p) => p.user_id)]) {
      if (id && id !== params.actorId) recipients.add(id);
    }
    for (const recipientUserId of recipients) {
      try {
        await createNotification(supabase, {
          organizationId: project.organization_id,
          projectId: params.projectId,
          recipientUserId,
          title: params.title,
          body: params.body,
          link: `/inspect/standalone/${params.assignmentId}`,
        });
      } catch {
        // one bad recipient must not stop the rest
      }
    }
  } catch {
    // best-effort
  }
}

export type AssignmentType = "fat" | "witness_inspection" | "specific_test" | "pre_shipment";
// R16: a conditional pass leaves the assignment genuinely open ("conditional_open") until its
// linked punch item(s) are closed and a clearance is issued — only then does it become "completed",
// same as a clean pass/fail does immediately on finalize.
export type AssignmentStatus = "draft" | "conditional_open" | "completed";
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
  discipline_id: string | null;
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

export interface StandaloneAssignmentEvidenceDocumentRow {
  id: string;
  assignment_id: string;
  vault_document_id: string;
  linked_by: string | null;
  created_at: string;
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
  /** Per-input problems (keys are form field names), shown beside the field. */
  fieldErrors?: Record<string, string>;
}

export async function createAssignmentAction(
  _prev: CreateAssignmentState,
  formData: FormData
): Promise<CreateAssignmentState> {
  const session = await requireSession();

  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { error: "Project, assignment type and equipment description are required.", fieldErrors: { project_id: "Choose a project." } };

  const supabase = await createSupabaseServerClient();
  if (!(await canRunStandaloneAssignment(session, supabase, projectId))) return { error: STAFF_ONLY_ERROR };

  const assignmentType = String(formData.get("assignment_type") ?? "").trim() as AssignmentType;
  const equipmentDescription = String(formData.get("equipment_description") ?? "").trim();
  const manufacturer = String(formData.get("manufacturer") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const serialTag = String(formData.get("serial_tag") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const standardReference = String(formData.get("standard_reference") ?? "").trim();
  const assignmentDate = String(formData.get("assignment_date") ?? "").trim();
  const disciplineId = String(formData.get("discipline_id") ?? "").trim();

  if (equipmentDescription.length > 300 || manufacturer.length > 120 || model.length > 120 || serialTag.length > 120 || location.length > 200 || standardReference.length > 200) {
    return { error: "One of the fields is too long. Shorten the equipment, serial, location or standard text." };
  }
  if (assignmentDate) {
    const d = new Date(assignmentDate + "T00:00:00Z");
    const now = Date.now();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assignmentDate) || Number.isNaN(d.getTime())) return { error: "Assignment date is not a valid date.", fieldErrors: { assignment_date: "Enter a valid date." } };
    if (d.getTime() < now - 5 * 365 * 86400000 || d.getTime() > now + 2 * 365 * 86400000) {
      return { error: "Assignment date looks wrong - it must be within the last 5 years and the next 2 years.", fieldErrors: { assignment_date: "Must be within the last 5 years and the next 2 years." } };
    }
  }
  if ((assignmentType === "fat" || assignmentType === "pre_shipment") && !serialTag) {
    return {
      error: "Serial / tag number is required for a FAT or pre-shipment check so the report identifies the exact unit.",
      fieldErrors: { serial_tag: "Required for a FAT or pre-shipment check so the report identifies the exact unit." },
    };
  }

  if (!projectId || !ASSIGNMENT_TYPES.includes(assignmentType) || !equipmentDescription) {
    return {
      error: "Project, assignment type and equipment description are required.",
      fieldErrors: {
        ...(!equipmentDescription ? { equipment_description: "Describe the equipment." } : {}),
      },
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("project_number, organization_id")
    .eq("id", projectId)
    .maybeSingle<{ project_number: string; organization_id: string }>();

  if (!project) {
    return { error: "Project not found." };
  }
  // Location: live coordinates or one of the project's presets only (no free-typed place names).
  let normalisedLocation: string | null = null;
  if (location) {
    const presetNames = (await getLocationPresetsForProject(supabase, project.organization_id, projectId)).map((p) => p.name);
    const norm = normaliseLocation(location, presetNames);
    if ("error" in norm) return { error: norm.error };
    normalisedLocation = norm.value;
  }
  if (disciplineId) {
    const { count: discCount } = await supabase
      .from("master_disciplines")
      .select("id", { count: "exact", head: true })
      .eq("id", disciplineId);
    if (!discCount) return { error: "Selected discipline not found." };
  }

  // Atomic per-project-per-type counter (next_document_sequence) — a plain count-then-insert would
  // let two assignments of the same type created at the same moment collide on the same number,
  // which is exactly the race the 23505 handling below used to paper over rather than prevent.
  // The counter can lag behind numbers that already exist (records imported or inserted by hand), so a
  // number that is already taken is skipped: take the next one, a few times, before asking the user to retry.
  let assignment: { id: string } | null = null;
  let assignmentNumber = "";
  let insertError: { code?: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    let rawSeq: number;
    try {
      rawSeq = await nextSequenceNumber(supabase, {
        organizationId: project.organization_id,
        projectId,
        seqKey: `standalone_assignment:${assignmentType}`,
      });
    } catch (err) {
      if (err instanceof NumberingError) return { error: err.message };
      throw err;
    }
    const seq = String(rawSeq).padStart(3, "0");
    assignmentNumber = `${project.project_number}-${ASSIGNMENT_TYPE_PREFIX[assignmentType]}-${seq}`;

    const { data: inserted, error } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .insert({
        project_id: projectId,
        assignment_number: assignmentNumber,
        assignment_type: assignmentType,
        equipment_description: equipmentDescription,
        manufacturer: manufacturer || null,
        model: model || null,
        serial_tag: serialTag || null,
        location: normalisedLocation,
        standard_reference: standardReference || null,
        assignment_date: assignmentDate || null,
        discipline_id: disciplineId || null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single<{ id: string }>();
    if (!error && inserted) {
      assignment = inserted;
      insertError = null;
      break;
    }
    insertError = error;
    if (error?.code !== "23505") break; // only a taken number is worth retrying
  }

  if (!assignment) {
    if (insertError?.code === "23505") {
      return { error: "That assignment number was just taken — please try again." };
    }
    return { error: "Could not create the assignment. Check you have permission and try again." };
  }

  await recordAuditEvent(supabase, {
    organizationId: project.organization_id,
    projectId,
    entityType: "standalone_assignment",
    entityId: assignment.id,
    action: "created",
    actorId: user?.id ?? null,
    summary: `Standalone assignment ${assignmentNumber} created`,
  });

  redirect(`/inspect/standalone/${assignment.id}`);
}

function parseMeasurementNumber(raw: string): number | null {
  const m = raw.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** nominal +/- tolerance (e.g. "12.0", "±0.5"; a "%" tolerance is relative) against the actual
 *  reading. Returns null when any of the three cannot be parsed as a number. */
function computeMeasurementResult(nominal: string, tolerance: string, actual: string): "pass" | "fail" | null {
  const n = parseMeasurementNumber(nominal);
  const a = parseMeasurementNumber(actual);
  let t = parseMeasurementNumber(tolerance);
  if (n == null || a == null || t == null) return null;
  t = Math.abs(t);
  if (tolerance.includes("%")) t = Math.abs(n) * (t / 100);
  return Math.abs(a - n) <= t + 1e-9 ? "pass" : "fail";
}

export interface AddMeasurementState {
  error: string | null;
}

export async function addMeasurementAction(
  _prev: AddMeasurementState,
  formData: FormData
): Promise<AddMeasurementState> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const nominalValue = String(formData.get("nominal_value") ?? "").trim();
  const tolerance = String(formData.get("tolerance") ?? "").trim();
  const actualValue = String(formData.get("actual_value") ?? "").trim();
  const unit = String(formData.get("unit") ?? "").trim();
  const manualResult = String(formData.get("result") ?? "").trim();

  if (!assignmentId || !description) {
    return { error: "Description is required." };
  }

  // Tolerance pass/fail is computed from the numbers when they parse; a manual choice is only the
  // fallback for non-numeric readings (e.g. "OK", "no leaks").
  const parsedActual = parseMeasurementNumber(actualValue);
  if (actualValue && parsedActual == null && manualResult !== "pass" && manualResult !== "fail") {
    return { error: "Actual value isn't a number. Enter a number (e.g. 12.0) or choose Pass/Fail manually." };
  }
  const result = computeMeasurementResult(nominalValue, tolerance, actualValue) ?? manualResult;

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireDraft: true });
  if (access.error) return { error: access.error };

  const { count } = await supabase
    .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  // Offline replay key (set by the offline-sync route from X-Idempotency-Key, never by the live form).
  // A replay of a reading that already landed hits the unique (assignment_id, client_key) index and is
  // a no-op; two genuinely identical readings carry different keys and both save.
  const clientKey = sanitizeClientKey(String(formData.get("client_key") ?? ""));
  const measurementRow: Record<string, unknown> = {
    assignment_id: assignmentId,
    description,
    nominal_value: nominalValue || null,
    tolerance: tolerance || null,
    actual_value: actualValue || null,
    unit: unit || null,
    result: result === "pass" || result === "fail" ? result : null,
    sort_order: count ?? 0,
  };
  let { error } = await supabase
    .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
    .insert(clientKey ? { ...measurementRow, client_key: clientKey } : measurementRow);
  if (error && clientKey && error.code === "23505") {
    return { error: null }; // this exact queued item already landed
  }
  if (error && clientKey && isMissingSchemaError(error)) {
    // client_key column not migrated yet: fall back to the previous guard, narrowed to an identical
    // reading recorded in the last few minutes (a replay, not a deliberate repeat).
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    let dupQuery = supabase
      .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("description", description)
      .gte("created_at", since)
      .limit(1);
    dupQuery = actualValue ? dupQuery.eq("actual_value", actualValue) : dupQuery.is("actual_value", null);
    dupQuery = nominalValue ? dupQuery.eq("nominal_value", nominalValue) : dupQuery.is("nominal_value", null);
    const { data: dup } = await dupQuery;
    if (dup && dup.length > 0) return { error: null };
    ({ error } = await supabase.from(STANDALONE_ASSIGNMENT_MEASUREMENTS).insert(measurementRow));
  }

  if (error) {
    return { error: "Could not add the measurement. Check you have permission and try again." };
  }

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment_measurement",
        entityId: assignmentId,
        action: "recorded",
        actorId: session.userId,
        summary: `Measurement recorded: ${description} (${assignmentRow.assignment_number})`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface SuggestMeasurementsState {
  error: string | null;
  suggestions: StandaloneMeasurementSuggestion[] | null;
}

const EMPTY_SUGGEST_MEASUREMENTS_STATE: SuggestMeasurementsState = { error: null, suggestions: null };

/**
 * Purely advisory: drafts a handful of equipment-specific measurement/test-parameter suggestions
 * for the inspector to review, one at a time, via their own "+ Add" (addMeasurementAction) —
 * mirrors the "AI drafts, human decides" rule used everywhere else in the app (e.g.
 * checkChecklistConsistencyAction, draftFatNarrativeAction). Never writes a measurement itself.
 */
export async function suggestStandaloneMeasurementsAction(
  _prev: SuggestMeasurementsState,
  formData: FormData
): Promise<SuggestMeasurementsState> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: assignment } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("assignment_type, equipment_description, manufacturer, model, standard_reference, project_id")
    .eq("id", assignmentId)
    .maybeSingle<
      Pick<
        StandaloneAssignmentRow,
        "assignment_type" | "equipment_description" | "manufacturer" | "model" | "standard_reference" | "project_id"
      >
    >();

  if (!assignment) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: "Assignment not found." };
  if (!(await canRunStandaloneAssignment(session, supabase, assignment.project_id))) {
    return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: STAFF_ONLY_ERROR };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", assignment.project_id)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_SUGGEST_MEASUREMENTS_STATE, error: gate.reason };

  try {
    // Grounded only in the equipment's own static fields (type/description/manufacturer/model/
    // standard) — the same piece of equipment on a different assignment hashes identically, so this
    // is a strong repeat-input candidate (a manufacturer/model combo showing up on more than one
    // FAT).
    const cacheInput = {
      assignmentType: assignment.assignment_type,
      equipmentDescription: assignment.equipment_description,
      manufacturer: assignment.manufacturer,
      model: assignment.model,
      standardReference: assignment.standard_reference,
    };
    const inputHash = hashAiCacheInput(cacheInput);
    const cached = await findCachedAiResponse<StandaloneMeasurementSuggestion[]>(supabase, {
      organizationId: project.organization_id,
      feature: "standalone_measurement_suggestion",
      promptVersion: PROMPT_VERSIONS.standalone_measurement_suggestion,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let suggestions: StandaloneMeasurementSuggestion[];
    if (cached) {
      suggestions = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.suggestStandaloneMeasurements(cacheInput));
      suggestions = captured.result;
      usage = captured.usage;
    }
    await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId: assignment.project_id,
      userId: user?.id ?? null,
      feature: "standalone_measurement_suggestion",
      modelId: getGeminiModel("standalone_measurement_suggestion"),
      promptVersion: PROMPT_VERSIONS.standalone_measurement_suggestion,
      sourceRef: { assignmentId, assignmentType: assignment.assignment_type },
      aiResponse: suggestions,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, suggestions };
  } catch (err) {
    return {
      ...EMPTY_SUGGEST_MEASUREMENTS_STATE,
      error: aiErrorMessage(err, "Could not generate measurement suggestions."),
    };
  }
}

export interface AddPunchItemState {
  error: string | null;
}

export async function addPunchItemAction(
  _prev: AddPunchItemState,
  formData: FormData
): Promise<AddPunchItemState> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!assignmentId || !description) {
    return { error: "Description is required." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { blockCompleted: true });
  if (access.error) return { error: access.error };
  if (description.length > 1000) return { error: "Description is too long (max 1000 characters)." };

  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_PUNCH_ITEMS).insert({
    assignment_id: assignmentId,
    description,
  });

  if (error) {
    return { error: "Could not add the punch item. Check you have permission and try again." };
  }

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment_punch_item",
        entityId: assignmentId,
        action: "created",
        actorId: session.userId,
        summary: `Punch item added: ${description} (${assignmentRow.assignment_number})`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface TogglePunchItemState {
  error: string | null;
}

export async function togglePunchItemAction(_prev: TogglePunchItemState, formData: FormData): Promise<TogglePunchItemState> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const punchItemId = String(formData.get("punch_item_id") ?? "").trim();
  const currentStatus = String(formData.get("current_status") ?? "").trim() as PunchItemStatus;
  const nextStatus: PunchItemStatus = currentStatus === "open" ? "closed" : "open";

  if (!assignmentId || !punchItemId || (currentStatus !== "open" && currentStatus !== "closed")) return { error: "Invalid request." };

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { blockCompleted: true });
  if (access.error) return { error: access.error };

  // Real gap the audit found: this single click was the ONLY gate between "conditional pass" and
  // fully cleared (issueClearanceAction below trusts punch items being non-'open' as its clearance
  // check) — the same person who ran the FAT could self-close their own punch item with zero
  // independent review or evidence, unlike the project-wide punch list's deliberate two-step
  // resolve→verify-close split (lib/punch-list/actions.ts). Mirrors that same authority bar rather
  // than building a second, inconsistent two-step flow for this smaller feature.
  if (access.projectId && nextStatus === "closed") {
    const canClose = isAdminStaff(session) || (await hasPermission(session.userId, "close_punch_item", access.projectId));
    if (!canClose) return { error: "Only a JAGS admin or someone allowed to close punch items can close a punch item." };
  }

  // Only applies if the row is still in the state the user saw: a double-click or stale tab can
  // never flip it straight back.
  const { data: toggled } = await supabase
    .from(STANDALONE_ASSIGNMENT_PUNCH_ITEMS)
    .update({ status: nextStatus })
    .eq("id", punchItemId)
    .eq("assignment_id", assignmentId)
    .eq("status", currentStatus)
    .select("id")
    .returns<{ id: string }[]>();
  if (!toggled || toggled.length === 0) {
    revalidatePath(`/inspect/standalone/${assignmentId}`);
    return { error: "This punch item was already changed. Refreshed." };
  }

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment_punch_item",
        entityId: punchItemId,
        action: nextStatus === "closed" ? "closed" : "reopened",
        actorId: session.userId,
        summary: `Punch item ${nextStatus} on ${assignmentRow.assignment_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
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

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const storagePath = String(formData.get("storage_path") ?? "").trim();
  const caption = String(formData.get("caption") ?? "").trim();

  if (!assignmentId || !storagePath) {
    return { error: "Upload failed — no file path was returned." };
  }
  if (!storagePath.startsWith(`standalone/${assignmentId}/`) || storagePath.includes("..")) {
    return { error: "Invalid photo path." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireOpen: true });
  if (access.error) return { error: access.error };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const photoRow: Record<string, unknown> = {
    assignment_id: assignmentId,
    storage_path: storagePath,
    caption: caption || null,
    uploaded_by: user?.id ?? null,
  };
  // Real capture time for photos taken offline (bounded; falls back to the server clock).
  const capturedAt = boundedCapturedAt(String(formData.get("captured_at") ?? ""));
  let { error } = await supabase.from(STANDALONE_ASSIGNMENT_PHOTOS).insert(capturedAt ? { ...photoRow, captured_at: capturedAt } : photoRow);
  if (error && capturedAt && isMissingSchemaError(error)) {
    ({ error } = await supabase.from(STANDALONE_ASSIGNMENT_PHOTOS).insert(photoRow));
  }

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

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const signatoryName = String(formData.get("signatory_name") ?? "").trim();
  const signatureData = String(formData.get("signature_data") ?? "").trim();

  if (role.length > 80 || signatoryName.length > 120) {
    return { error: "Role or signatory name is too long." };
  }
  if (!assignmentId || !role || !signatoryName || !signatureData) {
    return { error: "Role, signatory name and a captured signature are required." };
  }

  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(signatureData) || signatureData.length > 500_000) {
    return { error: "The captured signature is invalid or too large. Clear it and sign again." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireDraft: true });
  if (access.error) return { error: access.error };

  const clientKey = sanitizeClientKey(String(formData.get("client_key") ?? ""));
  const signedAt = boundedCapturedAt(String(formData.get("captured_at") ?? ""));
  const signatureRow: Record<string, unknown> = {
    assignment_id: assignmentId,
    role,
    signatory_name: signatoryName,
    signature_data: signatureData,
    // A signature drawn offline carries the time it was actually drawn, not the sync time.
    ...(signedAt ? { signed_at: signedAt } : {}),
  };
  let { error } = await supabase
    .from(STANDALONE_ASSIGNMENT_SIGNATURES)
    .insert(clientKey ? { ...signatureRow, client_key: clientKey } : signatureRow);
  if (error && clientKey && error.code === "23505") {
    return { error: null }; // this exact queued item already landed
  }
  if (error && clientKey && isMissingSchemaError(error)) {
    // client_key column not migrated yet: previous guard, narrowed to the same role + signatory in the last few minutes.
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: dup } = await supabase
      .from(STANDALONE_ASSIGNMENT_SIGNATURES)
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("role", role)
      .eq("signatory_name", signatoryName)
      .gte("signed_at", since)
      .limit(1);
    if (dup && dup.length > 0) return { error: null };
    ({ error } = await supabase.from(STANDALONE_ASSIGNMENT_SIGNATURES).insert(signatureRow));
  }

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

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!assignmentId) {
    return { error: "Missing assignment." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireDraft: true });
  if (access.error) return { error: access.error };

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

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const conclusion = String(formData.get("conclusion") ?? "").trim() as AssignmentConclusion;

  if (!assignmentId || !["pass", "conditional_pass", "fail"].includes(conclusion)) {
    return { error: "Select a conclusion before finalizing." };
  }

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId);
  if (access.error) return { error: access.error };

  // A FAT/witness/pre-shipment record's signatures are the actual evidence the test was witnessed —
  // finalizing (which locks the record) without at least one captured signature would produce a
  // "complete" report with no proof anyone was there. Require at least one before allowing the
  // otherwise-irreversible status change below.
  const { count: signatureCount, error: signatureCountError } = await supabase
    .from(STANDALONE_ASSIGNMENT_SIGNATURES)
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  if (signatureCountError) {
    return { error: "Could not verify signatures. Check you have permission and try again." };
  }
  if (!signatureCount) {
    return { error: "Capture at least one signature (e.g. the witness or vendor representative) before finalizing." };
  }

  // A Conditional Pass or Fail must say why - the notes become the stated reason on the FAT report,
  // so require them (saved on the Notes tab) before the record locks.
  if (conclusion !== "pass") {
    const { data: noteRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("notes")
      .eq("id", assignmentId)
      .maybeSingle<{ notes: string | null }>();
    if (!noteRow?.notes?.trim()) {
      return { error: `A ${conclusion === "fail" ? "Fail" : "Conditional Pass"} needs the reason recorded first. Add it on the Notes tab, then finalize.` };
    }
  }

  // A clean Pass cannot stand while a recorded measurement failed its tolerance.
  if (conclusion === "pass") {
    const { count: failedCount } = await supabase
      .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .eq("result", "fail");
    const { count: unresolvedCount } = await supabase
      .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .is("result", null);
    if (unresolvedCount) {
      return { error: `${unresolvedCount} measurement(s) have no pass/fail result. Record a result for each (or remove it) before finalizing as Pass.` };
    }
    if (failedCount) {
      return { error: `${failedCount} measurement(s) failed. Choose Conditional Pass (with a punch item) or Fail instead of Pass.` };
    }
  }

  // R16: a clean pass or fail is done the moment it's finalized. A conditional pass is NOT —
  // it stays genuinely open ("conditional_open") until its punch item is closed and clearance is
  // issued via issueClearanceAction below; only then does it reach "completed".
  const finalizedStatus: AssignmentStatus = conclusion === "conditional_pass" ? "conditional_open" : "completed";

  const { data, error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({
      status: finalizedStatus,
      conclusion,
      completed_at: finalizedStatus === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", assignmentId)
    .eq("status", "draft")
    .select("id, project_id, assignment_number, equipment_description, created_by")
    .returns<
      { id: string; project_id: string; assignment_number: string; equipment_description: string; created_by: string | null }[]
    >();

  if (error) {
    return { error: "Could not finalize the assignment. Check you have permission and try again." };
  }

  if (!data || data.length === 0) {
    return { error: "This assignment has already been finalized." };
  }

  const assignment = data[0];

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organization_id")
      .eq("id", assignment.project_id)
      .maybeSingle<{ organization_id: string }>();
    if (project?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: project.organization_id,
        projectId: assignment.project_id,
        entityType: "standalone_assignment",
        entityId: assignmentId,
        action: "finalized",
        actorId: session.userId,
        summary: `Assignment ${assignment.assignment_number} finalized — ${conclusion}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  // R95-96: a conditional pass on a FAT/witness/etc. always leaves something to close out before
  // handover — feed the project-wide punch list, same as a failed ITP-driven inspection does.
  if (conclusion === "conditional_pass") {
    const punch = await createPunchItemFromSource({
      projectId: assignment.project_id,
      description: `Conditional pass: ${assignment.equipment_description} (${assignment.assignment_number})`,
      source: "fat_conditional_pass",
      sourceStandaloneAssignmentId: assignmentId,
      dedupe: true,
    });
    if (punch.error) {
      // Without the linked punch item nothing would gate clearance - undo the finalize.
      await supabase
        .from(STANDALONE_ASSIGNMENTS)
        .update({ status: "draft", conclusion: null, completed_at: null })
        .eq("id", assignmentId)
        .eq("status", "conditional_open");
      revalidatePath(`/inspect/standalone/${assignmentId}`);
      return { error: "Could not create the linked punch-list item, so the assignment was not finalized. Try again." };
    }
  }

  // A failed FAT/assignment must be tracked to resolution: raise a linked punch item (best-effort;
  // the assignment has no responsible party / due date of its own, so those are left for triage).
  let failPunchMissing = false;
  if (conclusion === "fail") {
    // M3: never finalize a failure silently without its punch item. Retry (dedupe makes this safe);
    // if it still errors, undo the finalize when the DB allows it (admin), else say so loudly.
    let punchError: string | null = "unknown";
    for (let attempt = 0; attempt < 3 && punchError; attempt++) {
      const failPunch = await createPunchItemFromSource({
        projectId: assignment.project_id,
        description: `Failed: ${assignment.equipment_description} (${assignment.assignment_number})`,
        source: "manual",
        sourceStandaloneAssignmentId: assignmentId,
        priority: "A",
        dedupe: true,
      });
      punchError = failPunch.error;
    }
    if (punchError) {
      const { data: undone } = await supabase
        .from(STANDALONE_ASSIGNMENTS)
        .update({ status: "draft", conclusion: null, completed_at: null })
        .eq("id", assignmentId)
        .eq("status", "completed")
        .select("id")
        .returns<{ id: string }[]>();
      if (undone && undone.length > 0) {
        revalidatePath(`/inspect/standalone/${assignmentId}`);
        return { error: "Could not create the linked punch-list item for this failure, so the assignment was not finalized. Try again." };
      }
      failPunchMissing = true;
    }
  }

  await notifyAssignmentParties(supabase, {
    projectId: assignment.project_id,
    assignmentId,
    actorId: session.userId,
    extraUserIds: [assignment.created_by],
    title:
      conclusion === "fail"
        ? "Standalone assignment failed"
        : conclusion === "conditional_pass"
          ? "Standalone assignment conditionally passed"
          : "Standalone assignment passed",
    body: `${assignment.equipment_description} (${assignment.assignment_number})`,
  });

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  if (failPunchMissing) {
    return {
      error:
        "The assignment was finalized as Failed, but its linked punch-list item could not be created. Ask an admin to reopen it and finalize again, or add the punch item manually on the Punch List.",
    };
  }
  return { error: null };
}

export interface IssueClearanceState {
  error: string | null;
}

/**
 * R16's other half: closes out a "conditional_open" assignment once its punch item(s) are actually
 * cleared — the "clearance/close-out" the spec describes, distinct from the original finalize.
 * Deliberately re-checks the punch list itself (not just trusting the caller) so this can never be
 * used to skip past open items still sitting on the project's shared punch-list register.
 */
export async function issueClearanceAction(
  _prev: IssueClearanceState,
  formData: FormData
): Promise<IssueClearanceState> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const clearanceNotes = String(formData.get("clearance_notes") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };
  if (clearanceNotes.length < 5) return { error: "Record a short clearance note (what was verified / how the punch items were closed)." };
  if (clearanceNotes.length > 2000) return { error: "Clearance note is too long (max 2000 characters)." };

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId);
  if (access.error) return { error: access.error };

  // Clearance is an independent sign-off: same authority bar as closing a punch item.
  if (access.projectId && !isAdminStaff(session) && !(await hasPermission(session.userId, "close_punch_item", access.projectId))) {
    return { error: "Only a JAGS admin or someone allowed to close punch items can issue clearance." };
  }

  const { count: localOpenCount } = await supabase
    .from(STANDALONE_ASSIGNMENT_PUNCH_ITEMS)
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("status", "open");
  if (localOpenCount) {
    return { error: `${localOpenCount} punch item(s) on this assignment's own Punch List tab are still open - close them first.` };
  }

  const { count: openCount, error: openCountError } = await supabase
    .from(PUNCH_LIST_ITEMS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("source_standalone_assignment_id", assignmentId)
    .neq("status", "closed");

  if (openCountError) {
    return { error: "Could not check the linked punch item(s). Try again." };
  }
  if (openCount) {
    return {
      error: `${openCount} linked punch item(s) still open or awaiting verification — get them fully closed before issuing clearance.`,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: numRow } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("assignment_number")
    .eq("id", assignmentId)
    .maybeSingle<{ assignment_number: string }>();
  const { error, data } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({
      status: "completed",
      completed_at: nowIso,
      cleared_by: session.userId,
      cleared_at: nowIso,
      clearance_notes: clearanceNotes,
      clearance_number: numRow ? numRow.assignment_number + "-CLR" : null,
    })
    .eq("id", assignmentId)
    .eq("status", "conditional_open")
    .select("id")
    .returns<{ id: string }[]>();

  if (error) {
    return { error: "Could not issue clearance. Check you have permission and try again." };
  }
  if (!data || data.length === 0) {
    return { error: "This assignment isn't awaiting clearance (already cleared, or not conditionally passed)." };
  }

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment",
        entityId: assignmentId,
        action: "clearance_issued",
        actorId: session.userId,
        summary: `Clearance issued for assignment ${assignmentRow.assignment_number}`,
        changes: { clearance_notes: clearanceNotes },
      });
      await notifyAssignmentParties(supabase, {
        projectId: assignmentRow.project_id,
        assignmentId,
        actorId: session.userId,
        title: "Standalone assignment cleared",
        body: `Clearance issued for ${assignmentRow.assignment_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface LinkEvidenceDocumentState {
  error: string | null;
}

/**
 * Links an existing vault document as this standalone assignment's own evidence — the gap flagged
 * live: only photos (raw Storage uploads, no vault linkage) and signatures existed, with no way to
 * attach a controlled document (a spec sheet, a client-supplied drawing, a prior cert). Mirrors
 * linkItpItemEvidenceDocumentAction (lib/itps/evidence-actions.ts) exactly — upload to the
 * project's Vault first, link it here — rather than a second upload UI/storage path.
 */
export async function linkAssignmentEvidenceDocumentAction(
  _prev: LinkEvidenceDocumentState,
  formData: FormData
): Promise<LinkEvidenceDocumentState> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const vaultDocumentIds = [...new Set(formData.getAll("vault_document_id").map((v) => String(v).trim()).filter(Boolean))];
  if (!assignmentId || vaultDocumentIds.length === 0) return { error: "Select at least one file to link." };

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { blockCompleted: true });
  if (access.error) return { error: access.error };

  const { data: assignmentProject } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("project_id")
    .eq("id", assignmentId)
    .maybeSingle<{ project_id: string }>();
  {
    const { data: linkDocs } = await supabase
      .from("vault_documents")
      .select("id, status, vault_folders(project_id)")
      .in("id", vaultDocumentIds)
      .returns<{ id: string; status: string; vault_folders: { project_id: string } | null }[]>();
    if ((linkDocs ?? []).length !== vaultDocumentIds.length || (linkDocs ?? []).some((d) => d.vault_folders?.project_id !== assignmentProject?.project_id)) {
      return { error: "One of the selected files isn't in this project's own Document Vault." };
    }
    if ((linkDocs ?? []).some((d) => d.status !== "approved")) {
      return { error: "Only approved files can be linked as evidence — get the others approved in the Document Vault first." };
    }
  }

  const { error } = await supabase
    .from(STANDALONE_ASSIGNMENT_EVIDENCE_DOCUMENTS)
    .upsert(
      vaultDocumentIds.map((id) => ({ assignment_id: assignmentId, vault_document_id: id, linked_by: session.userId })),
      { onConflict: "assignment_id,vault_document_id", ignoreDuplicates: true }
    );

  if (error) return { error: "Could not link the selected files." };

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment_evidence_document",
        entityId: assignmentId,
        action: "linked",
        actorId: session.userId,
        summary: `Evidence document linked to assignment ${assignmentRow.assignment_number}`,
        changes: { vault_document_ids: vaultDocumentIds },
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

/** Removes the link (never deletes the underlying vault document — it may be referenced elsewhere). */
export async function unlinkAssignmentEvidenceDocumentAction(formData: FormData): Promise<void> {
  const session = await requireSession();

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const linkId = String(formData.get("link_id") ?? "").trim();
  if (!assignmentId || !linkId) return;

  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { blockCompleted: true });
  if (access.error) return;

  await supabase.from(STANDALONE_ASSIGNMENT_EVIDENCE_DOCUMENTS).delete().eq("id", linkId).eq("assignment_id", assignmentId);

  // Symmetry with linkAssignmentEvidenceDocumentAction, which already audits the link — found
  // missing in a self-review audit: removing evidence is just as much a "who did this" event as
  // adding it.
  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment_evidence_document",
        entityId: assignmentId,
        action: "unlinked",
        actorId: session.userId,
        summary: `Evidence document unlinked from ${assignmentRow.assignment_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
}

async function auditStandalone(
  supabase: SupabaseClient,
  assignmentId: string,
  session: Session,
  entityType: string,
  action: string,
  summaryPrefix: string,
  changes?: Record<string, unknown>
) {
  try {
    const { data: row } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("project_id, assignment_number, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ project_id: string; assignment_number: string; projects: { organization_id: string } | null }>();
    if (row?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: row.projects.organization_id,
        projectId: row.project_id,
        entityType,
        entityId: assignmentId,
        action,
        actorId: session.userId,
        summary: `${summaryPrefix} (${row.assignment_number})`,
        ...(changes ? { changes } : {}),
      });
    }
  } catch {
    // Best-effort.
  }
}

export interface ReopenAssignmentState {
  error: string | null;
}

/** Admin-only: returns a completed or conditional-open assignment (e.g. a failed FAT being re-tested) to draft, with a recorded reason. */
export async function reopenAssignmentAction(_prev: ReopenAssignmentState, formData: FormData): Promise<ReopenAssignmentState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return { error: "Only a JAGS admin can reopen a completed assignment." };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };
  if (reason.length < 10) return { error: "Record a reason for reopening (at least 10 characters)." };
  if (reason.length > 2000) return { error: "Reason is too long (max 2000 characters)." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({
      status: "draft",
      conclusion: null,
      completed_at: null,
      cleared_by: null,
      cleared_at: null,
      clearance_notes: null,
      clearance_number: null,
    })
    .eq("id", assignmentId)
    .in("status", ["completed", "conditional_open"])
    .select("id")
    .returns<{ id: string }[]>();
  if (error) return { error: "Could not reopen the assignment. Check you have permission and try again." };
  if (!data || data.length === 0) return { error: "Only a completed or conditionally open assignment can be reopened." };

  // M2: same supersede rule as an inspection that is re-completed. The failure / conditional-pass punch
  // items still untouched ("open") are withdrawn so a stale defect cannot block handover; items already
  // being worked (any other status) are left exactly as they are, and nothing is deleted. A new finalize
  // raises a fresh item (dedupe ignores closed ones). Best-effort, like the inspection path.
  try {
    const now = new Date().toISOString();
    const note = `Superseded: assignment was reopened for re-test (${reason})`;
    const { error: supersedeError } = await supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .update({ status: "closed", closing_evidence: note, verification_notes: note, withdrawn_at: now, withdrawn_by: session.userId, withdrawn_reason: note, closed_by: session.userId, closed_at: now })
      .eq("source_standalone_assignment_id", assignmentId)
      .eq("status", "open");
    if (supersedeError && !isMissingSchemaError(supersedeError)) console.error("[punch] standalone supersede failed", supersedeError.message);
  } catch {
    // Best-effort.
  }

  await auditStandalone(supabase, assignmentId, session, "standalone_assignment", "reopened", "Assignment reopened to draft", { reason });
  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export async function deleteMeasurementAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const id = String(formData.get("measurement_id") ?? "").trim();
  if (!assignmentId || !id) return;
  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireDraft: true });
  if (access.error) return;
  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_MEASUREMENTS).delete().eq("id", id).eq("assignment_id", assignmentId);
  if (error) return;
  await auditStandalone(supabase, assignmentId, session, "standalone_assignment_measurement", "deleted", "Measurement deleted", { measurement_id: id });
  revalidatePath(`/inspect/standalone/${assignmentId}`);
}

export async function deletePhotoAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const id = String(formData.get("photo_id") ?? "").trim();
  if (!assignmentId || !id) return;
  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireOpen: true });
  if (access.error) return;
  const { data: photo } = await supabase
    .from(STANDALONE_ASSIGNMENT_PHOTOS)
    .select("storage_path")
    .eq("id", id)
    .eq("assignment_id", assignmentId)
    .maybeSingle<{ storage_path: string }>();
  if (!photo) return;
  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_PHOTOS).delete().eq("id", id).eq("assignment_id", assignmentId);
  if (error) return;
  try {
    await supabase.storage.from("inspection-evidence").remove([photo.storage_path]);
  } catch {
    // Best-effort: the record is gone either way.
  }
  await auditStandalone(supabase, assignmentId, session, "standalone_assignment_photo", "deleted", "Photo deleted", { photo_id: id, storage_path: photo.storage_path });
  revalidatePath(`/inspect/standalone/${assignmentId}`);
}

export async function deleteSignatureAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const id = String(formData.get("signature_id") ?? "").trim();
  if (!assignmentId || !id) return;
  const supabase = await createSupabaseServerClient();
  const access = await requireStandaloneAccess(session, supabase, assignmentId, { requireDraft: true });
  if (access.error) return;
  const { error } = await supabase.from(STANDALONE_ASSIGNMENT_SIGNATURES).delete().eq("id", id).eq("assignment_id", assignmentId);
  if (error) return;
  await auditStandalone(supabase, assignmentId, session, "standalone_assignment_signature", "deleted", "Signature deleted", { signature_id: id });
  revalidatePath(`/inspect/standalone/${assignmentId}`);
}
