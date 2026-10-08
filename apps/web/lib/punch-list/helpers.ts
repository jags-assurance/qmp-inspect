// Pure helpers for the punch list (no server/client directives so both sides and tests can use them).
import { isValidTimeZone, siteToday } from "@/lib/ncrs/site-date";

export const PUNCH_MAX_WALKDOWN_ROWS = 50;
export const PUNCH_MAX_DESCRIPTION = 2000;
export const PUNCH_MAX_LOCATION = 200;
export const PUNCH_MAX_FILES_PER_ROW = 10;

/** Real calendar-date check: rejects 2026-02-31 (Date would roll it over to March). Empty is allowed. */
export function validDueDate(v: string): boolean {
  if (!v) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today as a UTC date-only string (YYYY-MM-DD). */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The one overdue rule: due date (date-only, UTC) strictly before today (UTC) and not closed. */
export function isPunchOverdue(
  r: { due_date: string | null; status: string },
  now: Date = new Date(),
  /** The project's IANA zone: "today" is then the site day. Omitted = UTC day. */
  timeZone?: string | null
): boolean {
  if (!r.due_date || r.status === "closed") return false;
  return r.due_date.slice(0, 10) < (isValidTimeZone(timeZone) ? siteToday(now, timeZone) : utcToday(now));
}

/**
 * Default due date for an auto-created punch item that was given none, so it can go overdue and
 * escalate: priority A 7 days, B 14 days, C 30 days from `today` (a YYYY-MM-DD site date).
 */
export function defaultPunchDueDate(priority: string, today: string): string {
  const days = priority === "A" ? 7 : priority === "C" ? 30 : 14;
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The due date to save: what was typed, else the priority default counted from the site's today. */
export function resolvePunchDueDate(typed: string | null | undefined, priority: string, today: string): string {
  const t = (typed ?? "").trim();
  return t || defaultPunchDueDate(priority, today);
}

export const PUNCH_IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
};

/**
 * Determines the image type from the file bytes (magic numbers) and cross-checks the extension.
 * Returns the canonical ext + content type, or null when it is not an allowed raster image (SVG is
 * rejected because it can carry script).
 */
export function detectPunchImage(
  bytes: Uint8Array,
  fileName: string
): { ext: string; contentType: string } | null {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  const claimed = PUNCH_IMAGE_TYPES[ext];
  if (!claimed) return null;
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  let detected: string | null = null;
  if (startsWith([0xff, 0xd8, 0xff])) detected = "image/jpeg";
  else if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) detected = "image/png";
  else if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) detected = "image/webp";
  else if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...Array.from(bytes.slice(8, 12)));
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(brand)) detected = "image/heic";
  }
  if (!detected || detected !== claimed) return null;
  return { ext: ext === "jpeg" ? "jpg" : ext === "heif" ? "heic" : ext, contentType: detected };
}

export function csvCell(v: string): string {
  // Neutralise spreadsheet formula injection (leading = + - @ tab CR).
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map((c) => csvCell(String(c ?? ""))).join(",");
}
