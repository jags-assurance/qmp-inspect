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
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus, todayUtc } from "./status";
import {
  isMissingDbObject,
  isRegisterRowActive,
  isRegisterRowCounted,
  isRegisterRowVerified,
  type RegisterRowMeta,
} from "./lifecycle";

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
 * Looks at what an ITP activity needs from the registers and, if it needs one, looks up a relevant
 * register row for this project and summarises it. The requirement is the activity's explicit
 * required_registers when set; otherwise it falls back to a keyword heuristic over the reference_spec /
 * acceptance_criteria prose (see pickRegisterKind). Most activities need nothing and this returns null
 * for them, unchanged from the plain Yes/No/N-A flow.
 *
 * Only rows that are ACTIVE (not superseded/retired/withdrawn) and VERIFIED by JAGS staff count; a row a
 * contractor typed in but staff haven't verified yet is reported as such, never as "current".
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
    /** Explicit per-activity requirement (itp_items.required_registers); wins over the keyword heuristic. */
    requiredRegisters?: string[] | null;
    /** When given and requiredRegisters isn't, the requirement is read from this activity (tolerates the column missing). */
    itpItemId?: string | null;
    /** The calendar day to judge "in date" against (the inspection date); defaults to today (UTC). */
    today?: Date;
  }
): Promise<RegisterVerificationResult | null> {
  const required = params.requiredRegisters ?? (params.itpItemId ? await fetchRequiredRegisters(supabase, params.itpItemId) : null);
  const kind = pickRegisterKind(params.itpItemReferenceSpec, params.itpItemAcceptanceCriteria, required);
  const today = params.today ?? todayUtc();

  if (kind === "calibration") {
    return params.selected?.calibrationAssetId
      ? verifyCalibrationAssetById(supabase, params.projectId, params.selected.calibrationAssetId, today)
      : checkCalibration(supabase, params.projectId, today);
  }
  if (kind === "welder") {
    return params.selected?.welderId
      ? verifyWelderById(supabase, params.projectId, params.selected.welderId, today)
      : checkWelder(supabase, params.projectId, today);
  }
  if (kind === "material") {
    return params.selected?.materialId
      ? verifyMaterialById(supabase, params.projectId, params.selected.materialId)
      : checkMaterial(supabase, params.projectId);
  }
  return null;
}

/** One register row an inspector linked a checklist answer to, with its verification/lifecycle state. */
export async function fetchLinkedRegisterRow(
  supabase: SupabaseClient,
  kind: "calibration" | "welder" | "material",
  projectId: string,
  id: string
): Promise<(RegisterRowMeta & { due_date?: string; expiry_date?: string; receipt_status?: string }) | null> {
  const table = kind === "calibration" ? CALIBRATION_REGISTER_TABLE : kind === "welder" ? WELDER_QUALIFICATION_REGISTER_TABLE : MATERIAL_REGISTER_TABLE;
  const columns = kind === "calibration" ? "due_date" : kind === "welder" ? "expiry_date" : "receipt_status";
  const rows = await selectRegisterRows<RegisterRowMeta & { due_date?: string; expiry_date?: string; receipt_status?: string }>(
    supabase,
    table,
    columns,
    (q) => q.eq("project_id", projectId).eq("id", id).limit(1)
  );
  return rows[0] ?? null;
}

/** Reads itp_items.required_registers; null when unset or when the column isn't deployed yet. */
export async function fetchRequiredRegisters(supabase: SupabaseClient, itpItemId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("itp_items")
    .select("required_registers" as never)
    .eq("id", itpItemId)
    .maybeSingle<{ required_registers: string[] | null }>();
  if (error || !data?.required_registers || data.required_registers.length === 0) return null;
  return data.required_registers;
}

/**
 * Which register an activity needs. An explicit per-activity requirement wins (calibration, then
 * welder, then material when several are named); only without one does the keyword heuristic over the
 * activity prose apply (calibration beats weld beats material).
 */
export function pickRegisterKind(
  referenceSpec: string | null,
  acceptanceCriteria: string | null,
  required?: string[] | null
): "calibration" | "welder" | "material" | null {
  if (required && required.length > 0) {
    for (const k of ["calibration", "welder", "material"] as const) if (required.includes(k)) return k;
    return null; // e.g. only "personnel" — handled by checkPersonnelCertification
  }
  const haystack = `${referenceSpec ?? ""} ${acceptanceCriteria ?? ""}`.toLowerCase();
  if (haystack.includes("calibrat")) return "calibration";
  if (haystack.includes("weld")) return "welder";
  if (haystack.includes("material") || haystack.includes("submittal")) return "material";
  return null;
}

/**
 * select with the verification/lifecycle columns, falling back to the base columns when the database
 * hasn't had migration 20261103000100 applied yet (those rows are then treated as verified + active).
 */
export async function selectRegisterRows<T>(
  supabase: SupabaseClient,
  table: unknown,
  baseColumns: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- registers tables aren't in the generated types
  build: (query: any) => PromiseLike<{ data: unknown; error: { code?: string | null } | null }>,
  extraColumns = ""
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (columns: string) => build((supabase as any).from(table).select(columns));
  const extra = extraColumns ? `, ${extraColumns}` : "";
  // created_by (migration 20261208000800) lets the page show contributors their own unverified rows.
  let res = await run(`${baseColumns}, verified_at, lifecycle_status, created_by${extra}`);
  if (res.error && isMissingDbObject(res.error)) res = await run(`${baseColumns}, verified_at, lifecycle_status${extra}`);
  if (res.error && isMissingDbObject(res.error)) res = await run(baseColumns);
  return (res.data as T[] | null) ?? [];
}

const unverifiedNote = "has not been verified by JAGS staff yet";
const inactiveNote = (row: RegisterRowMeta) => `is ${row.lifecycle_status ?? "no longer active"} and no longer an active entry`;

/** Picks the best row for the coarse "any entry on the project" check: counted rows first. */
function bestRow<T extends RegisterRowMeta>(rows: T[], isCurrent: (r: T) => boolean): T | undefined {
  const counted = rows.filter(isRegisterRowCounted);
  return counted.find(isCurrent) ?? counted[0] ?? rows.find(isRegisterRowActive) ?? rows[0];
}

// ── Calibration ─────────────────────────────────────────────────────────────────────────────

type CalibrationEntry = Pick<CalibrationRegisterRow, "instrument_name" | "cert_number" | "due_date"> & RegisterRowMeta;
const CALIBRATION_COLUMNS = "instrument_name, cert_number, due_date";

function calibrationResult(entry: CalibrationEntry | null | undefined, today: Date = todayUtc()): RegisterVerificationResult {
  if (!entry) {
    return {
      tone: "warning",
      message: `Calibration record not found for this project (Calibration Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "calibration",
    };
  }
  const label = `${entry.instrument_name} (cert ${entry.cert_number})`;
  if (!isRegisterRowActive(entry)) {
    return { tone: "warning", message: `Calibration ${label} ${inactiveNote(entry)} (Calibration Register). ${SOFT_STOP_SUFFIX}`, requiresOverrideReason: true, kind: "calibration" };
  }
  if (!isRegisterRowVerified(entry)) {
    return { tone: "warning", message: `Calibration ${label} ${unverifiedNote} (Calibration Register). ${SOFT_STOP_SUFFIX}`, requiresOverrideReason: true, kind: "calibration" };
  }
  // Recomputed from the date, never the stored status, which goes stale between page visits.
  if (computeCalibrationStatus(entry.due_date, today) === "expired") {
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

async function checkCalibration(supabase: SupabaseClient, projectId: string, today: Date): Promise<RegisterVerificationResult> {
  const rows = await selectRegisterRows<CalibrationEntry>(supabase, CALIBRATION_REGISTER_TABLE, CALIBRATION_COLUMNS, (q) =>
    q.eq("project_id", projectId).order("due_date", { ascending: false })
  );
  // Any current, verified instrument satisfies the coarse check; otherwise surface an expired one.
  return calibrationResult(bestRow(rows, (r) => computeCalibrationStatus(r.due_date, today) !== "expired"), today);
}

/** Checks the specific calibration-register row the inspector chose (must belong to the project). */
export async function verifyCalibrationAssetById(
  supabase: SupabaseClient,
  projectId: string,
  id: string,
  today: Date = todayUtc()
): Promise<RegisterVerificationResult> {
  const rows = await selectRegisterRows<CalibrationEntry>(supabase, CALIBRATION_REGISTER_TABLE, CALIBRATION_COLUMNS, (q) =>
    q.eq("project_id", projectId).eq("id", id).limit(1)
  );
  return calibrationResult(rows[0], today);
}

/** Active calibration-register rows for a project, for the "which instrument did you use" picker shown
 *  alongside a calibration-kind registerVerification — see response-row.tsx. A separate query
 *  because the picker needs every candidate instrument the inspector might have actually used. */
export async function listCalibrationOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; instrument_name: string; cert_number: string; status: string }[]> {
  const rows = await selectRegisterRows<Pick<CalibrationRegisterRow, "id" | "instrument_name" | "cert_number" | "due_date"> & RegisterRowMeta>(
    supabase,
    CALIBRATION_REGISTER_TABLE,
    "id, instrument_name, cert_number, due_date",
    (q) => q.eq("project_id", projectId).order("instrument_name")
  );
  return rows.filter(isRegisterRowCounted).map((r) => ({
    id: r.id,
    instrument_name: r.instrument_name,
    cert_number: r.cert_number,
    status: computeCalibrationStatus(r.due_date),
  }));
}

// ── Welder ──────────────────────────────────────────────────────────────────────────────────

type WelderEntry = Pick<WelderQualificationRegisterRow, "welder_identifier" | "qualified_wps" | "expiry_date"> & RegisterRowMeta;
const WELDER_COLUMNS = "welder_identifier, qualified_wps, expiry_date";

function welderResult(entry: WelderEntry | null | undefined, today: Date = todayUtc()): RegisterVerificationResult {
  if (!entry) {
    return {
      tone: "warning",
      message: `Welder qualification record not found for this project (Welder Qualification Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "welder",
    };
  }
  const label = `${entry.welder_identifier} on ${entry.qualified_wps}`;
  if (!isRegisterRowActive(entry)) {
    return { tone: "warning", message: `Welder qualification ${label} ${inactiveNote(entry)} (Welder Qualification Register). ${SOFT_STOP_SUFFIX}`, requiresOverrideReason: true, kind: "welder" };
  }
  if (!isRegisterRowVerified(entry)) {
    return { tone: "warning", message: `Welder qualification ${label} ${unverifiedNote} (Welder Qualification Register). ${SOFT_STOP_SUFFIX}`, requiresOverrideReason: true, kind: "welder" };
  }
  if (computeWelderStatus(entry.expiry_date, today) === "expired") {
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

async function checkWelder(supabase: SupabaseClient, projectId: string, today: Date): Promise<RegisterVerificationResult> {
  const rows = await selectRegisterRows<WelderEntry>(supabase, WELDER_QUALIFICATION_REGISTER_TABLE, WELDER_COLUMNS, (q) =>
    q.eq("project_id", projectId).order("expiry_date", { ascending: false })
  );
  return welderResult(bestRow(rows, (r) => computeWelderStatus(r.expiry_date, today) !== "expired"), today);
}

/** Checks the specific welder-register row the inspector chose (must belong to the project). */
export async function verifyWelderById(
  supabase: SupabaseClient,
  projectId: string,
  id: string,
  today: Date = todayUtc()
): Promise<RegisterVerificationResult> {
  const rows = await selectRegisterRows<WelderEntry>(supabase, WELDER_QUALIFICATION_REGISTER_TABLE, WELDER_COLUMNS, (q) =>
    q.eq("project_id", projectId).eq("id", id).limit(1)
  );
  return welderResult(rows[0], today);
}

/** Welder rows for the "which welder" picker (active, verified rows only). */
export async function listWelderOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; welder_identifier: string; qualified_wps: string; status: string }[]> {
  const rows = await selectRegisterRows<
    Pick<WelderQualificationRegisterRow, "id" | "welder_identifier" | "qualified_wps" | "expiry_date"> & RegisterRowMeta
  >(supabase, WELDER_QUALIFICATION_REGISTER_TABLE, "id, welder_identifier, qualified_wps, expiry_date", (q) =>
    q.eq("project_id", projectId).order("welder_identifier")
  );
  return rows.filter(isRegisterRowCounted).map((r) => ({
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
> &
  RegisterRowMeta;
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

  if (!isRegisterRowActive(entry)) {
    return {
      tone: "warning",
      message: `Material ${entry.material_description}${refSuffix} ${inactiveNote(entry)} (Material Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "material",
    };
  }
  if (!isRegisterRowVerified(entry)) {
    return {
      tone: "warning",
      message: `Material ${entry.material_description}${refSuffix} ${unverifiedNote} (Material Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
      kind: "material",
    };
  }

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
  const rows = await selectRegisterRows<MaterialEntry>(supabase, MATERIAL_REGISTER_TABLE, MATERIAL_COLUMNS, (q) =>
    q.eq("project_id", projectId).order("created_at", { ascending: false })
  );
  return materialResult(bestRow(rows, isUsableMaterial));
}

/** Checks the specific material-register row the inspector chose (must belong to the project). */
export async function verifyMaterialById(
  supabase: SupabaseClient,
  projectId: string,
  id: string
): Promise<RegisterVerificationResult> {
  const rows = await selectRegisterRows<MaterialEntry>(supabase, MATERIAL_REGISTER_TABLE, MATERIAL_COLUMNS, (q) =>
    q.eq("project_id", projectId).eq("id", id).limit(1)
  );
  return materialResult(rows[0]);
}

/** Released, active, verified materials only, for the "material used (heat/batch)" picker. */
export async function listMaterialOptions(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ id: string; material_description: string; heat_number: string | null; batch_number: string | null }[]> {
  const rows = await selectRegisterRows<
    { id: string; material_description: string; heat_number: string | null; batch_number: string | null } & RegisterRowMeta
  >(supabase, MATERIAL_REGISTER_TABLE, "id, material_description, heat_number, batch_number", (q) =>
    q.eq("project_id", projectId).eq("receipt_status", "released").order("material_description")
  );
  return rows.filter(isRegisterRowCounted).map(({ id, material_description, heat_number, batch_number }) => ({
    id,
    material_description,
    heat_number,
    batch_number,
  }));
}

// ── Personnel ───────────────────────────────────────────────────────────────────────────────

// Same coarse heuristic as pickRegisterKind above, but mapping activity text to the kind of
// personal certification it plausibly requires (rather than to a register table). certification_type
// is free text (see types.ts), so the second half of the match is also a keyword check against it
// rather than an exact code lookup. An activity whose required_registers names "personnel" matches ANY
// certificate the executing person holds.
const PERSONNEL_CERT_ACTIVITY_MATCHES: { activityKeywords: string[]; certKeywords: string[] }[] = [
  { activityKeywords: ["weld"], certKeywords: ["weld"] },
  {
    activityKeywords: ["ndt", "non-destruct", "nondestructive", "radiograph", "ultrasonic", "penetrant", "magnetic particle"],
    certKeywords: ["ndt", "nde", "asnt"],
  },
  { activityKeywords: ["electric"], certKeywords: ["electric"] },
];

type PersonnelEntry = Pick<PersonnelCertificationRow, "certification_type" | "cert_number" | "expiry_date" | "project_party_id"> &
  RegisterRowMeta & { holder_user_id?: string | null };

/**
 * Personnel-certification soft-stop: confirms the PERSON about to record the response holds a current
 * certification for that kind of work. A certificate with a named holder (holder_user_id) is matched to
 * the executing user; certificates without one belong to the whole party and are matched by party. When
 * the executing user is JAGS staff (no party), only certificates naming them as holder are considered.
 *
 * Returns null (not applicable) when the activity doesn't need a certificate, or when there is nobody to
 * check (no party link and no holder-named certificate for the user).
 */
export async function checkPersonnelCertification(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    executingProjectPartyId: string | null;
    itpItemReferenceSpec: string | null;
    itpItemAcceptanceCriteria: string | null;
    executingUserId?: string | null;
    requiredRegisters?: string[] | null;
    itpItemId?: string | null;
    today?: Date;
  }
): Promise<RegisterVerificationResult | null> {
  if (!params.executingProjectPartyId && !params.executingUserId) return null;
  const today = params.today ?? todayUtc();

  const required = params.requiredRegisters ?? (params.itpItemId ? await fetchRequiredRegisters(supabase, params.itpItemId) : null);
  let certKeywords: string[] | null = null; // null = any certificate type
  if (required && required.length > 0) {
    if (!required.includes("personnel")) return null;
  } else {
    const haystack = `${params.itpItemReferenceSpec ?? ""} ${params.itpItemAcceptanceCriteria ?? ""}`.toLowerCase();
    const match = PERSONNEL_CERT_ACTIVITY_MATCHES.find((m) => m.activityKeywords.some((kw) => haystack.includes(kw)));
    if (!match) return null;
    certKeywords = match.certKeywords;
  }

  const rows = await selectRegisterRows<PersonnelEntry>(
    supabase,
    PERSONNEL_CERTIFICATIONS_TABLE,
    "certification_type, cert_number, expiry_date, project_party_id",
    (q) => q.eq("project_id", params.projectId).order("expiry_date", { ascending: false }),
    "holder_user_id"
  );

  const mine = rows.filter((row) => {
    if (row.holder_user_id) return !!params.executingUserId && row.holder_user_id === params.executingUserId;
    return !!params.executingProjectPartyId && row.project_party_id === params.executingProjectPartyId;
  });
  // JAGS staff with no certificate naming them: nothing to check (same as before).
  if (!params.executingProjectPartyId && mine.length === 0 && !required) return null;

  const candidates = mine.filter((row) => !certKeywords || certKeywords.some((kw) => row.certification_type.toLowerCase().includes(kw)));
  const entry = bestRow(candidates, (r) => computePersonnelCertificationStatus(r.expiry_date, today) !== "expired");

  if (!entry) {
    return {
      tone: "warning",
      message: `Personnel certification record not found for this person for this type of activity (Personnel Certification Register). ${SOFT_STOP_SUFFIX}`,
      requiresOverrideReason: true,
    };
  }
  const label = `${entry.certification_type}${entry.cert_number ? ` (cert ${entry.cert_number})` : ""}`;
  if (!isRegisterRowActive(entry)) {
    return { tone: "warning", message: `Personnel certification ${label} ${inactiveNote(entry)} (Personnel Certification Register). ${SOFT_STOP_SUFFIX}`, requiresOverrideReason: true };
  }
  if (!isRegisterRowVerified(entry)) {
    return { tone: "warning", message: `Personnel certification ${label} ${unverifiedNote} (Personnel Certification Register). ${SOFT_STOP_SUFFIX}`, requiresOverrideReason: true };
  }

  if (computePersonnelCertificationStatus(entry.expiry_date, today) === "expired") {
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
