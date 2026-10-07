// Pure helpers shared by the Data Book / handover actions and readiness calculation.
import type { DataBookReadiness } from "./readiness";
import type { ConditionalOpenItem } from "./types";

export const PAGE_SIZE = 1000;
export const IN_CHUNK_SIZE = 200;
export const MAX_BOOK_NUMBER_LENGTH = 60;
export const MAX_BOOK_TITLE_LENGTH = 200;
export const MAX_CERT_NUMBER_LENGTH = 60;
export const MAX_ACK_NAME_LENGTH = 120;

export function chunk<T>(items: T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Page<T> = PromiseLike<{ data: T[] | null; error?: unknown }>;

/** Reads every row of a query by looping .range() pages (PostgREST silently caps a single response at 1000 rows). */
export async function fetchAllRows<T>(page: (from: number, to: number) => Page<T>, pageSize = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await page(from, from + pageSize - 1);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}

/** Runs one query per 200-id chunk (avoids huge URL-length .in() lists) and concatenates the results. */
export async function fetchInChunks<T>(ids: string[], run: (idChunk: string[]) => Promise<T[]>): Promise<T[]> {
  const results = await Promise.all(chunk(ids).map(run));
  return results.flat();
}

/** Valid handover package storage path: handover/<dataBookId>/<file> with no traversal. */
export function isValidPackagePath(path: string, dataBookId: string): boolean {
  if (!path.startsWith(`handover/${dataBookId}/`)) return false;
  if (path.includes("..") || path.includes("//") || path.endsWith("/")) return false;
  return path.length > `handover/${dataBookId}/`.length;
}

export function isValidSha256(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

export interface OutstandingCategory {
  category: string;
  outstanding: number;
  total: number;
  ready: number;
}

/** Every failing readiness category (including punch) as a plain list, for override snapshots and messages. */
export function failingReadinessCategories(r: DataBookReadiness): OutstandingCategory[] {
  const cats = [r.itps, r.inspectionRecords, r.checklists, r.calibrationRegister, r.welderRegister, r.personnelRegister, r.materialRegister, r.standaloneAssignments, r.ncrs];
  const out: OutstandingCategory[] = cats
    .filter((c) => c.percentage !== 100)
    .map((c) => ({ category: c.label, outstanding: c.total - c.ready, total: c.total, ready: c.ready }));
  if (r.openPunchItems > 0) {
    out.push({ category: "Punch list items closed", outstanding: r.openPunchItems, total: r.openPunchItems, ready: 0 });
  }
  return out;
}

/** Converts failing categories into override_items rows (same shape as punch snapshots), id prefixed "category:". */
export function categoriesToOverrideItems(cats: OutstandingCategory[]): ConditionalOpenItem[] {
  return cats.map((c) => ({
    id: `category:${c.category}`,
    description: `${c.category}: ${c.outstanding} outstanding (${c.ready} of ${c.total} ready)`,
    location: null,
    due_date: null,
    responsible_party_name: null,
  }));
}

export function validateBookFields(bookNumber: string, title: string): string | null {
  if (!bookNumber || !title) return "Book number and title are required.";
  if (bookNumber.length > MAX_BOOK_NUMBER_LENGTH) return `Book number must be ${MAX_BOOK_NUMBER_LENGTH} characters or fewer.`;
  if (title.length > MAX_BOOK_TITLE_LENGTH) return `Title must be ${MAX_BOOK_TITLE_LENGTH} characters or fewer.`;
  return null;
}

/** True when any of the given change timestamps is later than the PDF's completion time. Null/invalid values are ignored. */
export function isPdfOutOfDate(pdfCompletedAt: string | null | undefined, changeTimestamps: (string | null | undefined)[]): boolean {
  if (!pdfCompletedAt) return false;
  const done = Date.parse(pdfCompletedAt);
  if (Number.isNaN(done)) return false;
  return changeTimestamps.some((t) => {
    if (!t) return false;
    const ts = Date.parse(t);
    return !Number.isNaN(ts) && ts > done;
  });
}
