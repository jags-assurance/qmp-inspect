// Pure escalation ladder for overdue NCRs / punch items (no I/O, unit-tested).
//
//   tier 1 (any overdue, and the due-soon reminder): the people doing the work
//   tier 2 (>= TIER2_DAYS overdue): + those who verify / close (close permission holders)
//   tier 3 (>= TIER3_DAYS overdue): + organisation admins
//
// Dates are compared as calendar days in the site's timezone (SITE_UTC_OFFSET_HOURS, default +4 for
// the Gulf), not UTC.

export const TIER2_DAYS = 3;
export const TIER3_DAYS = 7;
export const DUE_SOON_DAYS = 2;

export function siteOffsetHours(): number {
  const raw = Number(process.env.SITE_UTC_OFFSET_HOURS);
  return Number.isFinite(raw) && raw >= -12 && raw <= 14 ? raw : 4;
}

/** The site's calendar date (YYYY-MM-DD) at `now`. */
export function siteDate(now: Date = new Date(), offsetHours: number = siteOffsetHours()): string {
  return new Date(now.getTime() + offsetHours * 3_600_000).toISOString().slice(0, 10);
}

/** Whole days from `fromDate` to `toDate` (both YYYY-MM-DD); positive when toDate is later. */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

export type EscalationTier = 0 | 1 | 2 | 3;

/** 0 = not overdue; otherwise the ladder tier for how many days past due the item is. */
export function escalationTier(dueDate: string, today: string): EscalationTier {
  const overdueDays = daysBetween(dueDate, today);
  if (overdueDays <= 0) return 0;
  if (overdueDays >= TIER3_DAYS) return 3;
  if (overdueDays >= TIER2_DAYS) return 2;
  return 1;
}

/** Is the item due within the reminder window (today .. today + DUE_SOON_DAYS)? */
export function isDueSoon(dueDate: string, today: string): boolean {
  const until = daysBetween(today, dueDate);
  return until >= 0 && until <= DUE_SOON_DAYS;
}
