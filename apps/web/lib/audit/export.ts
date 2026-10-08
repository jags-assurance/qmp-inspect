// Pure helpers for exporting a project's audit log (CSV route + PDF job request). No I/O except the
// caller-supplied page fetcher, so escaping, row mapping, filter parsing and paging are unit tested.

import { dateRangeToFromIso, parseDateRange } from "@/lib/dates/date-range";

/** Rows fetched per round trip (PostgREST caps a response at 1000 rows by default). */
export const AUDIT_EXPORT_PAGE_SIZE = 1000;

/** The filters the audit log page offers; the export honours exactly the same ones. */
export interface AuditExportFilters {
  /** ISO lower bound for created_at, or null for "all time". */
  fromIso: string | null;
  /** entity_type, or null for every category. */
  cat: string | null;
  /** actor user id, or null for everyone. */
  actor: string | null;
}

const CAT_RE = /^[a-z0-9_]{1,64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same parsing as the page (?range=&cat=&actor=), with cat/actor shape-checked since they end up in a query. */
export function parseAuditExportFilters(sp: { range?: string | null; cat?: string | null; actor?: string | null }, now: Date = new Date()): AuditExportFilters {
  const cat = sp.cat && CAT_RE.test(sp.cat) ? sp.cat : null;
  const actor = sp.actor && UUID_RE.test(sp.actor) ? sp.actor : null;
  return { fromIso: dateRangeToFromIso(parseDateRange(sp.range ?? undefined), now), cat, actor };
}

/** Human description of the filters, printed in the CSV preamble note and the PDF header. */
export function describeAuditFilters(f: AuditExportFilters, actorName?: string | null): string {
  const parts = [f.fromIso ? `events since ${f.fromIso.slice(0, 10)}` : "all recorded events"];
  if (f.cat) parts.push(`category: ${f.cat}`);
  if (f.actor) parts.push(`person: ${actorName || f.actor}`);
  return parts.join("; ");
}

export interface AuditExportRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  summary: string;
  changes: Record<string, unknown> | null;
  created_at: string;
  actor_id: string | null;
  actor: { full_name: string | null; email: string | null } | null;
}

export const AUDIT_CSV_HEADERS = ["Timestamp (UTC)", "Actor", "Actor email", "Record type", "Record ID", "Action", "Summary", "Changes (JSON)"] as const;

/**
 * One CSV cell. Cells that a spreadsheet would read as a formula (leading = + - @, or a tab / CR which
 * some apps strip before evaluating) get a leading apostrophe; cells containing a quote, comma or line
 * break are quoted with embedded quotes doubled. Audit text is user-influenced, so this is strict:
 * even "-5" is prefixed rather than trusted to be a number.
 */
export function auditCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function auditCsvLine(cells: unknown[]): string {
  return cells.map(auditCsvCell).join(",") + "\r\n";
}

/** UTC timestamp as `YYYY-MM-DD HH:mm:ss`; falls back to the raw text when it does not parse. */
export function formatAuditTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 19);
}

export function auditRowToCsvCells(r: AuditExportRow): string[] {
  return [
    formatAuditTimestamp(r.created_at),
    r.actor?.full_name ?? (r.actor_id ? "Unknown user" : "System"),
    r.actor?.email ?? "",
    r.entity_type,
    r.entity_id,
    r.action,
    r.summary,
    r.changes ? JSON.stringify(r.changes) : "",
  ];
}

export function auditCsvHeaderLine(): string {
  return auditCsvLine([...AUDIT_CSV_HEADERS]);
}

/**
 * Pages through every matching row with a caller-supplied fetcher (range is inclusive, like PostgREST's
 * .range). Stops on the first short page, so there is no row cap; a fetch error propagates to the caller.
 */
export async function* iterateAuditPages(
  fetchPage: (from: number, to: number) => Promise<AuditExportRow[]>,
  pageSize: number = AUDIT_EXPORT_PAGE_SIZE
): AsyncGenerator<AuditExportRow[]> {
  for (let from = 0; ; from += pageSize) {
    const rows = await fetchPage(from, from + pageSize - 1);
    if (rows.length > 0) yield rows;
    if (rows.length < pageSize) return;
  }
}

/** Filename for a download, safe for a Content-Disposition header. */
export function auditExportFilename(projectNumber: string, ext: "csv" | "pdf", now: Date = new Date()): string {
  const safe = projectNumber.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "project";
  return `audit-log-${safe}-${now.toISOString().slice(0, 10)}.${ext}`;
}
