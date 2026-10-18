// Pure attempt / naming / filing-path logic for inspection documents (no I/O).
//
// An "attempt" is one inspection_records row of an ITP activity; Attempt A is the first, B the next, ...
// KEEP IN SYNC with worker/src/jobs/vaultFiling.ts, which files the generated reports with these names.
//
// Deterministic filing path of a generated inspection document:
//   <project> > <discipline> > <ITP> > <activity>
// Vault folders stay the fixed per-project categories (folder_key is relied on by many callers);
// the path is stored as `vault_documents.filing_path` and drives the zip layout / Data Book listing.

export interface FilingDiscipline {
  code: string;
  name: string;
}

export interface FilingContext {
  projectLabel: string;
  discipline: FilingDiscipline | null;
  itpNumber: string;
  itemNumber: string | null;
  activity: string;
}

export const UNASSIGNED_DISCIPLINE_LABEL = "Unassigned discipline";

/** 0 -> "A", 1 -> "B", ... 25 -> "Z", 26 -> "AA" (spreadsheet-style, never ambiguous). */
export function attemptLetter(index: number): string {
  let n = Math.max(0, Math.trunc(Number.isFinite(index) ? index : 0));
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface AttemptRecord {
  id: string;
  created_at: string;
  overall_result: "pass" | "fail" | "partial" | null;
}

/** Oldest first; ties broken by id so the order (and therefore every letter) is deterministic. */
export function orderAttempts<T extends { id: string; created_at: string }>(records: T[]): T[] {
  return [...records].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

/** Attempt letter of `recordId` among all records of the same activity (A = first inspection). */
export function attemptLetterFor(records: AttemptRecord[], recordId: string): string {
  const idx = orderAttempts(records).findIndex((r) => r.id === recordId);
  return attemptLetter(idx < 0 ? records.length : idx);
}

export function isPassingResult(result: string | null | undefined): boolean {
  return result === "pass" || result === "partial";
}

/** Failed attempts created BEFORE the given (passing) record: their filed reports become superseded-by-pass. */
export function earlierFailedAttempts<T extends AttemptRecord>(records: T[], passingRecordId: string): T[] {
  const ordered = orderAttempts(records);
  const idx = ordered.findIndex((r) => r.id === passingRecordId);
  if (idx < 0) return [];
  return ordered.slice(0, idx).filter((r) => r.overall_result === "fail");
}

/**
 * The attempt the Data Book presents for an activity: the latest PASSING attempt; when none passed yet,
 * the newest attempt. `earlier` = every other failed attempt of the activity, oldest first (the appendix).
 */
export function selectFinalAndEarlierAttempts<T extends AttemptRecord>(records: T[]): { final: T | null; earlier: T[] } {
  const ordered = orderAttempts(records);
  if (ordered.length === 0) return { final: null, earlier: [] };
  const passing = ordered.filter((r) => isPassingResult(r.overall_result));
  const final = passing.length > 0 ? passing[passing.length - 1] : ordered[ordered.length - 1];
  return { final, earlier: ordered.filter((r) => r.id !== final.id && r.overall_result === "fail") };
}

function resultLabel(result: string | null | undefined): string {
  if (result === "pass") return "Pass";
  if (result === "fail") return "Fail";
  if (result === "partial") return "Pass with comments";
  return "Draft";
}

/** `Inspection Report INSP-1 — Attempt B (Fail) — Weld visual`. document_reference stays the record number. */
export function buildInspectionReportTitle(p: { recordNumber: string; attempt: string; result: string | null; activity: string }): string {
  return `Inspection Report ${p.recordNumber} — Attempt ${p.attempt} (${resultLabel(p.result)}) — ${p.activity}`;
}

/** Storage / download base name (no extension, no revision): `INSP-1-attemptB`. */
export function buildAttemptFileBase(recordNumber: string, attempt: string): string {
  return `${recordNumber}-attempt${attempt}`;
}

function cleanLabel(value: string): string {
  // "/" is the path separator, so it can never appear inside one segment.
  return value.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim();
}

/** Segments of the deterministic path: project, discipline, ITP, activity. */
export function buildFilingSegments(ctx: FilingContext): string[] {
  const discipline = ctx.discipline ? cleanLabel(`${ctx.discipline.code} - ${ctx.discipline.name}`) : UNASSIGNED_DISCIPLINE_LABEL;
  const activity = cleanLabel(ctx.itemNumber ? `${ctx.itemNumber} ${ctx.activity}` : ctx.activity);
  return [cleanLabel(ctx.projectLabel) || "Project", discipline, cleanLabel(ctx.itpNumber) || "ITP", activity || "Activity"].map((s) =>
    s.slice(0, 120)
  );
}

/** Stored form of the path (`vault_documents.filing_path`). */
export function buildFilingPath(ctx: FilingContext): string {
  return buildFilingSegments(ctx).join(" / ");
}

/** Splits a stored filing_path back into segments. */
export function parseFilingPath(path: string | null | undefined): string[] {
  return (path ?? "")
    .split(" / ")
    .map((s) => s.trim())
    .filter(Boolean);
}
/** 0 → "A", 1 → "B", 25 → "Z", 26 → "AA". */
export function attemptLabel(revision: number): string {
  let n = Math.max(0, Math.floor(revision));
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface AttemptSummary {
  revision: number;
  result: string | null;
}

/** What the person looking at the checklist should do next, given the finished attempts (newest first). */
export function reinspectionState(finished: AttemptSummary[]): {
  /** The attempt a new run would be, e.g. "B". */
  nextLabel: string;
  /** The newest finished attempt failed, so the next run is a re-inspection. */
  isReinspection: boolean;
  failedLabel: string | null;
} {
  const nextRevision = finished.length === 0 ? 0 : Math.max(...finished.map((a) => a.revision)) + 1;
  const latest = [...finished].sort((a, b) => b.revision - a.revision)[0];
  const failed = latest?.result === "fail";
  return {
    nextLabel: attemptLabel(nextRevision),
    isReinspection: failed,
    failedLabel: failed ? attemptLabel(latest.revision) : null,
  };
}
