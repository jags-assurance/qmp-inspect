// Pure helpers for the extended NCR fields (location, tag, spec clause, root-cause category,
// disposition, impacts, contractor response). No I/O so they can be unit-tested. The columns come
// from supabase/migrations/20261102000200_ncr_punch_schema_and_helpers.sql; the actions strip
// them and retry when that migration has not been applied yet.

export const NCR_DISPOSITIONS = ["rework", "repair", "use_as_is", "reject", "concession"] as const;
export type NcrDisposition = (typeof NCR_DISPOSITIONS)[number];

export const NCR_DISPOSITION_LABELS: Record<NcrDisposition, string> = {
  rework: "Rework to specification",
  repair: "Repair (accepted method)",
  use_as_is: "Use as is (engineering justification)",
  reject: "Reject / replace",
  concession: "Accept by concession",
};

/** Built-in taxonomy used when the ncr_root_cause_categories table is missing or empty. */
export const DEFAULT_ROOT_CAUSE_CATEGORIES: { code: string; label: string }[] = [
  { code: "workmanship", label: "Workmanship / skill" },
  { code: "material", label: "Material / product defect" },
  { code: "design", label: "Design / drawing error" },
  { code: "method", label: "Method / procedure not followed" },
  { code: "equipment", label: "Equipment / tooling" },
  { code: "training", label: "Training / competence" },
  { code: "supervision", label: "Supervision / inspection gap" },
  { code: "documentation", label: "Documentation / communication" },
  { code: "environment", label: "Site conditions / environment" },
  { code: "other", label: "Other" },
];

export const NCR_MAX_SHORT_TEXT = 200;
export const NCR_MAX_LONG_TEXT = 2000;

/** Columns that exist only after the extended-fields migration. */
export const NCR_EXTENDED_COLUMNS = [
  "location",
  "equipment_tag",
  "spec_reference",
  "root_cause_category",
  "disposition",
  "cost_impact",
  "schedule_impact_days",
  "contractor_response",
] as const;

export interface NcrExtendedFields {
  location: string | null;
  equipment_tag: string | null;
  spec_reference: string | null;
  root_cause_category: string | null;
  disposition: NcrDisposition | null;
  cost_impact: number | null;
  schedule_impact_days: number | null;
  contractor_response: string | null;
}

type Raw = (name: string) => string | null | undefined;

function text(raw: string | null | undefined, max: number): string | null {
  const v = (raw ?? "").trim();
  return v ? v.slice(0, max) : null;
}

/**
 * Reads the extended fields from a form. Only fields that were actually submitted are returned
 * (`present` lists them), so a form that does not render a field never wipes the stored value.
 * Returns `error` for an invalid value instead of silently dropping it.
 */
export function parseNcrExtended(
  has: (name: string) => boolean,
  get: Raw
): { values: Partial<NcrExtendedFields>; error: string | null } {
  const values: Partial<NcrExtendedFields> = {};
  if (has("location")) values.location = text(get("location"), NCR_MAX_SHORT_TEXT);
  if (has("equipment_tag")) values.equipment_tag = text(get("equipment_tag"), NCR_MAX_SHORT_TEXT);
  if (has("spec_reference")) values.spec_reference = text(get("spec_reference"), NCR_MAX_SHORT_TEXT);
  if (has("root_cause_category")) {
    const v = (get("root_cause_category") ?? "").trim().toLowerCase();
    if (v && !/^[a-z0-9_]{2,40}$/.test(v)) return { values, error: "Root-cause category is not valid." };
    values.root_cause_category = v || null;
  }
  if (has("disposition")) {
    const v = (get("disposition") ?? "").trim();
    if (v && !(NCR_DISPOSITIONS as readonly string[]).includes(v)) return { values, error: "Disposition is not valid." };
    values.disposition = (v || null) as NcrDisposition | null;
  }
  if (has("cost_impact")) {
    const v = (get("cost_impact") ?? "").trim();
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return { values, error: "Cost impact must be a positive number." };
      values.cost_impact = Math.round(n * 100) / 100;
    } else values.cost_impact = null;
  }
  if (has("schedule_impact_days")) {
    const v = (get("schedule_impact_days") ?? "").trim();
    if (v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 3650) return { values, error: "Schedule impact must be a whole number of days (0 to 3650)." };
      values.schedule_impact_days = n;
    } else values.schedule_impact_days = null;
  }
  if (has("contractor_response")) values.contractor_response = text(get("contractor_response"), NCR_MAX_LONG_TEXT);
  return { values, error: null };
}

/** Removes the extended columns from a payload (graceful degradation before the migration is applied). */
export function stripExtendedColumns<T extends Record<string, unknown>>(payload: T): T {
  const copy: Record<string, unknown> = { ...payload };
  for (const c of NCR_EXTENDED_COLUMNS) delete copy[c];
  return copy as T;
}
