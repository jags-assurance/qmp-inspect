/** Pure helpers for the bulk IRN issue action and its results panel. */

export const BULK_IRN_MAX = 50;

export interface BulkIrnItemResult {
  id: string;
  status: "issued" | "already" | "skipped";
  /** The IRN number when freshly issued. */
  irnNumber?: string;
  /** Why it was skipped (the single-issue gate's own message). */
  reason?: string;
}

export interface BulkIrnResult {
  /** Request-level failure (nothing attempted). Per-item failures live in `items`. */
  error: string | null;
  items: BulkIrnItemResult[];
}

/** Trim, drop blanks, de-duplicate (order preserved) and enforce the batch cap. */
export function normaliseBulkIds(raw: unknown): { ids: string[]; error: string | null } {
  if (!Array.isArray(raw)) return { ids: [], error: "Select at least one inspection." };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return { ids, error: "Select at least one inspection." };
  if (ids.length > BULK_IRN_MAX) return { ids: [], error: `Select at most ${BULK_IRN_MAX} inspections at a time.` };
  return { ids, error: null };
}

/** Map one single-issue outcome to a per-item result. */
export function toBulkItem(id: string, out: { error: string | null; irnNumber?: string; already?: boolean }): BulkIrnItemResult {
  if (out.error) return { id, status: "skipped", reason: out.error };
  if (out.already || !out.irnNumber) return { id, status: "already" };
  return { id, status: "issued", irnNumber: out.irnNumber };
}

export function summariseBulk(items: BulkIrnItemResult[]): { issued: number; already: number; skipped: number } {
  const t = { issued: 0, already: 0, skipped: 0 };
  for (const i of items) t[i.status]++;
  return t;
}

/** A row can be offered for bulk issue only when completed (pass/partial) and without a live IRN. */
export function isBulkIrnEligible(r: { overall_result: "pass" | "fail" | "partial" | null; irn_number: string | null; irn_voided: boolean }): boolean {
  return (r.overall_result === "pass" || r.overall_result === "partial") && (!r.irn_number || r.irn_voided);
}
