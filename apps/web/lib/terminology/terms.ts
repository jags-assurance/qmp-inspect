/**
 * Admin-editable terminology (pure module: no I/O, safe on server and client).
 *
 * Only DISPLAY labels are renamed. Database values, routes and enum values (staff_role 'inspector',
 * severity 'observation', ...) never change. English text stays the i18n key; overrides are applied to
 * the displayed string afterwards (see applyTerms).
 */

export const TERM_KEYS = ["field_engineer", "observation", "ncr"] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export interface TermForms {
  singular: string;
  plural: string;
}

export type TermOverrides = Partial<Record<TermKey, TermForms>>;

export interface TermDefinition extends TermForms {
  key: TermKey;
  /** Plain-language description shown on the admin page. */
  description: string;
  /** Example sentence for the live preview; {term} / {terms} are replaced by the singular / plural. */
  example: string;
}

export const TERM_DEFINITIONS: readonly TermDefinition[] = [
  {
    key: "field_engineer",
    singular: "Field Engineer",
    plural: "Field Engineers",
    description: "The JAGS staff role that carries out site inspections.",
    example: "Each {term} is assigned to a project; {terms} sign off the inspections they carry out.",
  },
  {
    key: "observation",
    singular: "Observation",
    plural: "Observations",
    description: "The light finding below an NCR.",
    example: "Raise an {term} when something needs attention but is not a formal non-conformance; open {terms} stay on the register.",
  },
  {
    key: "ncr",
    singular: "NCR",
    plural: "NCRs",
    description: "A formal non-conformance report.",
    example: "A formal {term} is raised for a non-conformance; closed {terms} are kept for the audit trail.",
  },
];

const DEFINITION_BY_KEY = new Map<TermKey, TermDefinition>(TERM_DEFINITIONS.map((d) => [d.key, d]));

export function isTermKey(value: string): value is TermKey {
  return (TERM_KEYS as readonly string[]).includes(value);
}

export function defaultForms(key: TermKey): TermForms {
  const d = DEFINITION_BY_KEY.get(key)!;
  return { singular: d.singular, plural: d.plural };
}

/** The label for a term: the override when set, else the default. */
export function term(key: TermKey, overrides?: TermOverrides | null, opts?: { plural?: boolean }): string {
  const forms = overrides?.[key] ?? defaultForms(key);
  return opts?.plural ? forms.plural : forms.singular;
}

export const TERM_MIN_LENGTH = 2;
export const TERM_MAX_LENGTH = 40;

export type TermValidation = { ok: true; value: string } | { ok: false; error: string };

/** A label is trimmed, 2-40 characters, and may not contain angle brackets. */
export function validateTermLabel(raw: string): TermValidation {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < TERM_MIN_LENGTH || value.length > TERM_MAX_LENGTH) {
    return { ok: false, error: `Must be ${TERM_MIN_LENGTH}-${TERM_MAX_LENGTH} characters.` };
  }
  if (/[<>]/.test(value)) return { ok: false, error: "Must not contain < or >." };
  return { ok: true, value };
}

/**
 * Validates a singular/plural pair. A blank plural defaults to the singular plus "s". Returns forms
 * (null when identical to the default, meaning "no override") or an error message.
 */
export function validateTermForms(
  key: TermKey,
  singularRaw: string,
  pluralRaw: string
): { ok: true; forms: TermForms | null } | { ok: false; error: string } {
  const s = validateTermLabel(singularRaw);
  if (!s.ok) return { ok: false, error: `Singular: ${s.error}` };
  let plural = s.value.endsWith("s") ? s.value : `${s.value}s`;
  if (pluralRaw.trim() !== "") {
    const p = validateTermLabel(pluralRaw);
    if (!p.ok) return { ok: false, error: `Plural: ${p.error}` };
    plural = p.value;
  }
  const def = defaultForms(key);
  if (s.value === def.singular && plural === def.plural) return { ok: true, forms: null };
  return { ok: true, forms: { singular: s.value, plural } };
}

/** Reads the stored JSON defensively: unknown keys and invalid labels are ignored (default used). */
export function parseOverrides(raw: unknown): TermOverrides {
  const out: TermOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of TERM_KEYS) {
    const entry = (raw as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object") continue;
    const { singular, plural } = entry as Record<string, unknown>;
    if (typeof singular !== "string") continue;
    const v = validateTermForms(key, singular, typeof plural === "string" ? plural : "");
    if (v.ok && v.forms) out[key] = v.forms;
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchCase(matched: string, replacement: string, caseSensitive: boolean): string {
  if (caseSensitive) return replacement;
  if (matched.length > 1 && matched === matched.toUpperCase()) return replacement.toUpperCase();
  const first = matched.charAt(0);
  if (first !== first.toUpperCase() && replacement.length > 1 && replacement.charAt(1) === replacement.charAt(1).toLowerCase()) {
    return replacement.charAt(0).toLowerCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Replaces the default wording in a display string with the admin's overrides, e.g. with
 * field_engineer = "Site Engineer": "Field Engineers" -> "Site Engineers". Returns the input
 * untouched when there are no overrides. "NCR" is matched case-sensitively (it is an acronym).
 */
export function applyTerms(text: string, overrides?: TermOverrides | null): string {
  if (!overrides || !text) return text;
  let out = text;
  for (const key of TERM_KEYS) {
    const o = overrides[key];
    if (!o) continue;
    const def = defaultForms(key);
    const caseSensitive = key === "ncr";
    const re = new RegExp(`\\b(${escapeRe(def.plural)}|${escapeRe(def.singular)})\\b`, caseSensitive ? "g" : "gi");
    out = out.replace(re, (m) => matchCase(m, m.toLowerCase() === def.plural.toLowerCase() ? o.plural : o.singular, caseSensitive));
  }
  return out;
}

/** Fills the {term}/{terms} placeholders of a definition's example with the given forms. */
export function previewSentence(key: TermKey, forms: TermForms): string {
  return DEFINITION_BY_KEY.get(key)!.example.replaceAll("{terms}", forms.plural).replaceAll("{term}", forms.singular);
}
