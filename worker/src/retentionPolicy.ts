// S6-18: pure rules for document retention flagging. No database / env access, so it unit-tests
// cleanly; the sweep that uses it lives in retention.ts. Retention only FLAGS documents for human
// review - nothing here (or in the sweep) deletes or changes a document.

export const MIN_RETENTION_YEARS = 1;
export const MAX_RETENTION_YEARS = 100;
/** The sweep runs at most this often. */
export const RETENTION_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RetentionClock {
  created_at: string;
  approved_at?: string | null;
}

/** The clock starts when the document was approved, or uploaded if it never was. */
export function retentionReferenceDate(doc: RetentionClock): Date | null {
  const raw = doc.approved_at || doc.created_at;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `years` calendar years after `from`, in UTC; 29 Feb rolls back to 28 Feb in a non-leap year. */
export function addYearsUtc(from: Date, years: number): Date {
  const result = new Date(Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth(), from.getUTCDate()));
  if (result.getUTCMonth() !== from.getUTCMonth()) {
    // 29 Feb overflowed into March.
    return new Date(Date.UTC(from.getUTCFullYear() + years, from.getUTCMonth() + 1, 0));
  }
  return result;
}

const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

/** YYYY-MM-DD the retention period ends. */
export function retentionDueOn(reference: Date, years: number): string {
  return toDateString(addYearsUtc(reference, years));
}

/** Retention has run out once the due date is today or earlier (UTC dates). */
export function isPastRetention(reference: Date, years: number, now: number): boolean {
  return retentionDueOn(reference, years) <= toDateString(new Date(now));
}

/**
 * End of the UTC day that is `years` before `now`: a document created on or before it can already be past
 * retention (due date = reference date + years, compared by date), so it bounds the database query without
 * excluding anything isPastRetention() would accept.
 */
export function retentionCreatedCutoffIso(now: number, years: number): string {
  const startOfDay = addYearsUtc(new Date(now), -years).getTime();
  return new Date(startOfDay + 24 * 60 * 60 * 1000 - 1).toISOString();
}

export function isValidRetentionYears(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_RETENTION_YEARS && value <= MAX_RETENTION_YEARS;
}

export function shouldRunRetentionSweep(lastRunAt: number | null, now: number): boolean {
  return lastRunAt === null || now - lastRunAt >= RETENTION_SWEEP_INTERVAL_MS;
}

export interface FlagCandidate {
  id: string;
  created_at: string;
  approved_at?: string | null;
}

export interface NewFlag {
  document_id: string;
  retention_years: number;
  reference_date: string;
  due_on: string;
}

/** The candidates (already known not to be flagged) that are past retention, with the dates to record. */
export function selectDocumentsToFlag(candidates: FlagCandidate[], years: number, now: number): NewFlag[] {
  if (!isValidRetentionYears(years)) return [];
  const flags: NewFlag[] = [];
  for (const doc of candidates) {
    const reference = retentionReferenceDate(doc);
    if (!reference || !isPastRetention(reference, years, now)) continue;
    flags.push({
      document_id: doc.id,
      retention_years: years,
      reference_date: toDateString(reference),
      due_on: retentionDueOn(reference, years),
    });
  }
  return flags;
}
