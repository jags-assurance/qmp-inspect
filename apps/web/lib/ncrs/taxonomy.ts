// Pure helpers for the NCR root-cause taxonomy admin (the table check allows code ^[a-z0-9_]{2,40}$ and
// label 2..80 characters after trimming).

export const LABEL_MIN = 2;
export const LABEL_MAX = 80;
export const CODE_MAX = 40;
export const SORT_MIN = 0;
export const SORT_MAX = 9999;

/** Lower-case, underscore-separated code from a label: "Poor site lighting!" -> "poor_site_lighting". */
export function slugifyCode(label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CODE_MAX)
    .replace(/_+$/g, "");
  return slug;
}

export function validateLabel(raw: string): { label: string } | { error: string } {
  const label = raw.trim().replace(/\s+/g, " ");
  if (label.length < LABEL_MIN) return { error: `The name needs at least ${LABEL_MIN} characters.` };
  if (label.length > LABEL_MAX) return { error: `The name is too long (max ${LABEL_MAX} characters).` };
  return { label };
}

export function parseSortOrder(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= SORT_MIN && n <= SORT_MAX ? n : null;
}

/** Codes shorter than 2 characters (e.g. a label of only symbols) cannot be stored. */
export function usableCode(code: string): boolean {
  return /^[a-z0-9_]{2,40}$/.test(code);
}

export interface CategoryRow {
  id: string;
  organization_id: string | null;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

/** Platform defaults overridden by an organisation row with the same code; ordered by sort_order then label. */
export function mergeCategories(rows: CategoryRow[]): CategoryRow[] {
  const byCode = new Map<string, CategoryRow>();
  for (const r of rows.filter((x) => x.organization_id === null)) byCode.set(r.code, r);
  for (const r of rows.filter((x) => x.organization_id !== null)) byCode.set(r.code, r);
  return [...byCode.values()].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}
