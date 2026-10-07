// Pure helpers for the Data Book renderer: pagination, id chunking, issued-date handling and the
// defensive override_items normaliser. No Supabase client import so they can be unit tested.

export const PAGE_SIZE = 1000;
export const IN_CHUNK_SIZE = 200;
/** Hard ceiling on pages for one query (50M rows would be a runaway loop, not a data book). */
export const MAX_PAGES = 500;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Reads every row of a query, PAGE_SIZE at a time via .range(), so PostgREST's 1000-row cap can
 * never silently truncate a controlled record. Throws if any page fails or the loop cannot finish.
 * `build` must apply a deterministic order (include a unique tiebreaker such as id).
 */
export async function fetchAllPages<T>(
  label: string,
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
  maxPages: number = MAX_PAGES
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`Data book render aborted — could not read ${label} (rows ${from}+): ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
  throw new Error(`Data book render aborted — ${label} exceeded ${maxPages * pageSize} rows; pagination did not finish.`);
}

export function chunk<T>(values: T[], size: number = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Paginates a query once per 200-id chunk of `ids` and concatenates the rows. */
export async function fetchAllIn<T>(
  label: string,
  ids: string[],
  build: (idChunk: string[], from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  for (const ids200 of chunk([...new Set(ids)])) {
    all.push(...(await fetchAllPages<T>(label, (from, to) => build(ids200, from, to))));
  }
  return all;
}

/** Start of the UTC day a register status is evaluated against (issue date for issued books). */
export function registerAsOf(issuedDate: string | null | undefined, now: Date = new Date()): Date {
  if (issuedDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(issuedDate);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    const d = new Date(issuedDate);
    if (!Number.isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface OverrideCategory {
  category: string;
  label: string;
  count: number;
  items: string[];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

function itemLine(item: unknown): string | null {
  if (typeof item === "string") return str(item);
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const head = str(o.description) ?? str(o.title) ?? str(o.label) ?? str(o.number) ?? str(o.name) ?? str(o.id);
  if (!head) return null;
  const extras = [
    str(o.location) ? `Location: ${str(o.location)}` : null,
    str(o.responsible_party_name) ? `Responsible: ${str(o.responsible_party_name)}` : null,
    str(o.due_date) ? `Due: ${str(o.due_date)}` : null,
  ].filter(Boolean);
  return extras.length ? `${head} (${extras.join("; ")})` : head;
}

/**
 * Accepts both shapes of data_books.override_items / handover_certificates.conditional_open_items:
 *  - old: [{id, description, location, due_date, responsible_party_name}]  (punch items only)
 *  - new: [{category, label, count, items?}]  (every failing readiness category)
 * Anything unrecognised yields no categories rather than throwing.
 */
export function normaliseOverrideItems(raw: unknown): OverrideCategory[] {
  if (!Array.isArray(raw)) return [];
  const result: OverrideCategory[] = [];
  const legacyPunch: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    if (typeof o.category === "string") {
      const items = (Array.isArray(o.items) ? o.items : []).map(itemLine).filter((v): v is string => !!v);
      const n = Number(o.count);
      const count = Number.isFinite(n) && n >= 0 ? Math.trunc(n) : items.length;
      result.push({ category: o.category, label: str(o.label) ?? o.category.replace(/_/g, " "), count, items });
    } else {
      const line = itemLine(o);
      if (line) legacyPunch.push(line);
    }
  }
  if (legacyPunch.length) {
    result.unshift({ category: "punch", label: "Open punch list items", count: legacyPunch.length, items: legacyPunch });
  }
  return result;
}

/** Page-count / size caps for a rendered book. */
export const MAX_BOOK_PAGES = 2000;
export const MAX_BOOK_BYTES = 150 * 1024 * 1024;

export function assertBookWithinLimits(pages: number, bytes: number): string | null {
  if (pages > MAX_BOOK_PAGES) return `Data book is ${pages} pages, over the ${MAX_BOOK_PAGES}-page limit.`;
  if (bytes > MAX_BOOK_BYTES) return `Data book PDF is ${bytes} bytes, over the ${MAX_BOOK_BYTES}-byte limit.`;
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const GENERATED_PATH_PREFIX = "generated-documents:";

/** vault_documents.storage_path is stored as "generated-documents:<path>"; returns the bare bucket path. */
export function stripGeneratedPrefix(storedPath: string): string {
  return storedPath.startsWith(GENERATED_PATH_PREFIX) ? storedPath.slice(GENERATED_PATH_PREFIX.length) : storedPath;
}
