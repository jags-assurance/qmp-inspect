// Central date formatting. Every formatter takes an explicit IANA time zone so a server component
// (Vercel runs in UTC) and a client component (the user's browser zone) render the SAME text for the
// same instant — the cause of "Text content did not match" hydration warnings and of "overdue" flipping
// hours early or late for a site east or west of UTC.
//
// Where the zone comes from: projects.timezone (20261104000500_project_and_org_timezone.sql), falling
// back to organizations.default_timezone, falling back to "UTC". Pass it down from the page that
// already loaded the project. Date-only values (a due date such as "2026-10-31") carry no instant and
// must NOT be shifted by a zone: use formatDateOnly().
//
// Guidance for other modules: replace `new Date(x).toLocaleString("en-GB")` with
// `formatDateTime(x, tz)` (and toLocaleDateString -> formatDate, toLocaleTimeString -> formatTime).

export const DEFAULT_TIME_ZONE = "UTC";
export const DEFAULT_LOCALE = "en-GB";

/** Returns `tz` if it is a valid IANA zone name, otherwise UTC (never throws). */
export function resolveTimeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "31/10/2026" */
export function formatDate(value: DateInput, tz?: string | null, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(DEFAULT_LOCALE, { timeZone: resolveTimeZone(tz) });
}

/** "31/10/2026, 14:05:09" */
export function formatDateTime(value: DateInput, tz?: string | null, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString(DEFAULT_LOCALE, { timeZone: resolveTimeZone(tz) });
}

/** "14:05" */
export function formatTime(value: DateInput, tz?: string | null, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleTimeString(DEFAULT_LOCALE, { timeZone: resolveTimeZone(tz), hour: "2-digit", minute: "2-digit" });
}

/** "Saturday 31 October 2026" */
export function formatDateLong(value: DateInput, tz?: string | null, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString(DEFAULT_LOCALE, {
    timeZone: resolveTimeZone(tz),
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "31 Oct 2026, 14:05" */
export function formatDateTimeMedium(value: DateInput, tz?: string | null, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString(DEFAULT_LOCALE, { timeZone: resolveTimeZone(tz), dateStyle: "medium", timeStyle: "short" });
}

/**
 * A calendar date with no time ("2026-10-31", or a timestamp whose date part is what matters).
 * Rendered in UTC on purpose: shifting a date-only value by a zone moves it a day.
 */
export function formatDateOnly(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return fallback;
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(DEFAULT_LOCALE, { timeZone: "UTC" });
}

/** Today's calendar date ("YYYY-MM-DD") in the given zone — the right "today" for overdue checks. */
export function todayInZone(tz?: string | null, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: resolveTimeZone(tz) });
}

/** True when a date-only due date ("YYYY-MM-DD") is before today in the given zone. */
export function isPastDueDate(dueDate: string | null | undefined, tz?: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  return dueDate.slice(0, 10) < todayInZone(tz, now);
}
