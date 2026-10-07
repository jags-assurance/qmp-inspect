// Worker-side copy of apps/web/lib/registers/status.ts (the worker cannot import from apps/web).
// Keep the windows and logic identical. Status is always recomputed from the date, never read from
// the stored column, which goes stale if nobody opens the registers page.

export const CALIBRATION_DUE_SOON_DAYS = 30;
export const WELDER_EXPIRING_DAYS = 90;
export const PERSONNEL_CERTIFICATION_EXPIRING_DAYS = 90;

export type RegisterDateStatus = "valid" | "soon" | "expired";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Calendar date (UTC-midnight Date) of `now` in an IANA time zone; UTC when missing/unknown. Mirrors the web copy. */
export function todayInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): Date {
  if (!timeZone) return todayUtc(now);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : todayUtc(now);
  } catch {
    return todayUtc(now);
  }
}

export function daysUntil(dateStr: string, today: Date = todayUtc()): number {
  const target = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

function compute(dateStr: string, windowDays: number, today: Date): RegisterDateStatus {
  const days = daysUntil(dateStr, today);
  if (days < 0) return "expired";
  if (days <= windowDays) return "soon";
  return "valid";
}

export const calibrationStatus = (due: string, today?: Date) => compute(due, CALIBRATION_DUE_SOON_DAYS, today ?? todayUtc());
export const welderStatus = (expiry: string, today?: Date) => compute(expiry, WELDER_EXPIRING_DAYS, today ?? todayUtc());
export const personnelStatus = (expiry: string, today?: Date) => compute(expiry, PERSONNEL_CERTIFICATION_EXPIRING_DAYS, today ?? todayUtc());

export function calibrationLabel(status: RegisterDateStatus): string {
  return status === "expired" ? "Calibration expired" : status === "soon" ? "Due within 30 days" : "In calibration";
}

export function qualificationLabel(status: RegisterDateStatus): string {
  return status === "expired" ? "Expired" : status === "soon" ? "Expiring within 90 days" : "Qualified";
}

/** dd-mm-yyyy; accepts a date or timestamp string. Returns an em dash for empty values. */
export function fmtDmy(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
}
