import type { CalibrationStatus, PersonnelCertificationStatus, WelderQualificationStatus } from "./types";

// Warning windows. Calibration cycles are tighter, so it gets the shorter lead time; welder
// qualifications and personal certifications need real lead time to renew.
export const CALIBRATION_DUE_SOON_DAYS = 30;
export const WELDER_EXPIRING_DAYS = 90;
export const PERSONNEL_CERTIFICATION_EXPIRING_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Today's calendar date (UTC) as a plain Date at midnight, so day counts never wobble with the time of day or timezone. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The calendar date (as a UTC-midnight Date, like todayUtc) that `now` falls on in an IANA time zone, so
 * "due today" flips at the site's midnight rather than at UTC midnight. Falls back to UTC for a missing
 * or unrecognised zone.
 */
export function todayInTimeZone(timeZone: string | null | undefined, now: Date = new Date()): Date {
  if (!timeZone) return todayUtc(now);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const y = get("year");
    const m = get("month");
    const d = get("day");
    if (!y || !m || !d) return todayUtc(now);
    return new Date(Date.UTC(y, m - 1, d));
  } catch {
    return todayUtc(now);
  }
}

/** Whole days from `today` until the (YYYY-MM-DD) date: 0 = due today, negative = already past. */
export function daysUntil(dateStr: string, today: Date = todayUtc()): number {
  const target = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
}

export function computeCalibrationStatus(dueDate: string, today: Date = todayUtc()): CalibrationStatus {
  const days = daysUntil(dueDate, today);
  if (days < 0) return "expired";
  if (days <= CALIBRATION_DUE_SOON_DAYS) return "due_soon";
  return "valid";
}

export function computeWelderStatus(expiryDate: string, today: Date = todayUtc()): WelderQualificationStatus {
  const days = daysUntil(expiryDate, today);
  if (days < 0) return "expired";
  if (days <= WELDER_EXPIRING_DAYS) return "expiring";
  return "valid";
}

export function computePersonnelCertificationStatus(expiryDate: string, today: Date = todayUtc()): PersonnelCertificationStatus {
  const days = daysUntil(expiryDate, today);
  if (days < 0) return "expired";
  if (days <= PERSONNEL_CERTIFICATION_EXPIRING_DAYS) return "expiring_soon";
  return "valid";
}

/** "in 12 days" / "due today" / "3 days overdue" — for showing next to a date. */
export function describeDays(days: number): string {
  if (days === 0) return "due today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  const overdue = Math.abs(days);
  return `${overdue} day${overdue === 1 ? "" : "s"} overdue`;
}
