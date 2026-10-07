// S7-18: reminder cadence for an issued handover certificate that the client has not acknowledged.
// Pure (no database / env access) so it unit-tests cleanly; the sweep lives in handoverReminders.ts.

/** First reminder once the certificate has waited this long. */
export const FIRST_REMINDER_AFTER_DAYS = 3;
/** Gap between later reminders. */
export const REMINDER_EVERY_DAYS = 7;
/** Stop nudging the client after this many reminders (the issuer is told on the last one). */
export const MAX_ACK_REMINDERS = 4;

const DAY_MS = 86_400_000;

export interface AckReminderState {
  /** Certificate issue date (YYYY-MM-DD) or timestamp. */
  issuedAt: string;
  reminderCount: number;
  lastReminderAt: string | null;
  acknowledgedAt?: string | null;
  rejectedAt?: string | null;
  supersededAt?: string | null;
  /** A certificate with no package file cannot be acknowledged, so it is never chased. */
  hasPackage: boolean;
}

/** Whether the client should be reminded now. */
export function isAckReminderDue(c: AckReminderState, now: number): boolean {
  if (c.acknowledgedAt || c.rejectedAt || c.supersededAt || !c.hasPackage) return false;
  if (c.reminderCount >= MAX_ACK_REMINDERS) return false;
  if (c.reminderCount <= 0 || !c.lastReminderAt) {
    const issued = Date.parse(c.issuedAt);
    return Number.isFinite(issued) && now - issued >= FIRST_REMINDER_AFTER_DAYS * DAY_MS;
  }
  const last = Date.parse(c.lastReminderAt);
  return Number.isFinite(last) && now - last >= REMINDER_EVERY_DAYS * DAY_MS;
}

/** The reminder that is about to be sent is the last one: tell the issuer as well. */
export function isFinalAckReminder(reminderCountBeforeSend: number): boolean {
  return reminderCountBeforeSend + 1 >= MAX_ACK_REMINDERS;
}

/** Whole days a certificate has been waiting, for the message text. */
export function daysWaiting(issuedAt: string, now: number): number {
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) return 0;
  return Math.max(0, Math.floor((now - issued) / DAY_MS));
}
