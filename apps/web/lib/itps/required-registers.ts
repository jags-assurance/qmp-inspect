// S3-06: explicit per-activity register requirement (itp_items.required_registers). Pure helpers.

export const REGISTER_KINDS = ["calibration", "welder", "material", "personnel"] as const;
export type RegisterKind = (typeof REGISTER_KINDS)[number];

export const REGISTER_KIND_LABEL: Record<RegisterKind, string> = {
  calibration: "Calibration",
  welder: "Welder",
  material: "Material",
  personnel: "Personnel",
};

/** Values from the checkboxes: known kinds only, de-duplicated, in a stable order. null = nothing required. */
export function parseRequiredRegisters(values: FormDataEntryValue[]): RegisterKind[] | null {
  const picked = new Set(values.map((v) => String(v)));
  const out = REGISTER_KINDS.filter((k) => picked.has(k));
  return out.length > 0 ? [...out] : null;
}

/** Rebuilds the list from a database column (could be null or hold unexpected text). */
export function normaliseRequiredRegisters(raw: unknown): RegisterKind[] {
  if (!Array.isArray(raw)) return [];
  const picked = new Set(raw.map((v) => String(v)));
  return REGISTER_KINDS.filter((k) => picked.has(k));
}

export function sameRegisters(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  const x = normaliseRequiredRegisters(a ?? []);
  const y = normaliseRequiredRegisters(b ?? []);
  return x.length === y.length && x.every((k, i) => k === y[i]);
}
