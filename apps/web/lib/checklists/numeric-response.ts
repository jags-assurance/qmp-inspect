// S4-20: pure rules for numeric checklist items (a measured value with limits). No database access, so it
// unit-tests cleanly and the SAME function decides the result on the client (instant feedback) and on the
// server (the only place the stored result is derived).

export type ItemValueType = "pass_fail" | "numeric";

export interface NumericSpec {
  min: number | null;
  max: number | null;
  unit: string | null;
}

/** Largest magnitude accepted; keeps the value inside Postgres numeric and the report layout. */
export const NUMERIC_VALUE_LIMIT = 1e12;

/** Parses what the inspector typed. Accepts "12.5" and "12,5"; rejects blanks, NaN, infinity and huge values. */
export function parseNumericInput(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(",", ".");
  if (!cleaned || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || Math.abs(n) > NUMERIC_VALUE_LIMIT) return null;
  return n;
}

/** 'yes' when the value is inside the limits (inclusive), otherwise 'no'. */
export function evaluateNumeric(value: number, spec: Pick<NumericSpec, "min" | "max">): "yes" | "no" {
  if (spec.min != null && value < spec.min) return "no";
  if (spec.max != null && value > spec.max) return "no";
  return "yes";
}

/** Human description of the limits, e.g. "10 to 12 mm", "at least 5 bar", "at most 0.5 mm". */
export function describeSpec(spec: NumericSpec): string {
  const unit = spec.unit ? ` ${spec.unit}` : "";
  if (spec.min != null && spec.max != null) return spec.min === spec.max ? `${spec.min}${unit}` : `${spec.min} to ${spec.max}${unit}`;
  if (spec.min != null) return `at least ${spec.min}${unit}`;
  if (spec.max != null) return `at most ${spec.max}${unit}`;
  return unit.trim();
}

/** Validates limits entered when an item is created; returns an error message or null. */
export function validateSpecInput(
  minRaw: string,
  maxRaw: string,
  unitRaw: string
): { spec: NumericSpec } | { error: string } {
  const min = minRaw.trim() ? parseNumericInput(minRaw) : null;
  const max = maxRaw.trim() ? parseNumericInput(maxRaw) : null;
  if (minRaw.trim() && min === null) return { error: "The minimum must be a number." };
  if (maxRaw.trim() && max === null) return { error: "The maximum must be a number." };
  if (min === null && max === null) return { error: "Give a minimum, a maximum, or both for a measured item." };
  if (min !== null && max !== null && min > max) return { error: "The minimum cannot be above the maximum." };
  const unit = unitRaw.trim().slice(0, 20);
  return { spec: { min, max, unit: unit || null } };
}

/** Rebuilds a spec from raw database columns (numeric columns can arrive as strings). */
export function specFromRow(row: { value_type?: string | null; numeric_min?: unknown; numeric_max?: unknown; numeric_unit?: string | null } | null | undefined): NumericSpec | null {
  if (!row || row.value_type !== "numeric") return null;
  const toNum = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const min = toNum(row.numeric_min);
  const max = toNum(row.numeric_max);
  if (min === null && max === null) return null;
  return { min, max, unit: row.numeric_unit ?? null };
}
