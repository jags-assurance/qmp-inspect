// Pure policy for notification retention. No database or env access so it unit-tests cleanly; the sweep
// that uses it lives in notificationRetention.ts.

export const READ_NOTIFICATION_MAX_AGE_DAYS = 90;
export const ANY_NOTIFICATION_MAX_AGE_DAYS = 365;
export const NOTIFICATION_RETENTION_BATCH_SIZE = 500;
export const NOTIFICATION_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Off unless NOTIFICATION_RETENTION_ENABLED is "true". */
export function isNotificationRetentionEnabled(env: Record<string, string | undefined>): boolean {
  return env.NOTIFICATION_RETENTION_ENABLED?.trim().toLowerCase() === "true";
}

export interface NotificationRetentionCutoffs {
  /** Read notifications created before this are deleted. */
  readBeforeIso: string;
  /** Any notification (read or not) created before this is deleted. */
  anyBeforeIso: string;
}

export function notificationRetentionCutoffs(nowMs: number): NotificationRetentionCutoffs {
  return {
    readBeforeIso: new Date(nowMs - READ_NOTIFICATION_MAX_AGE_DAYS * DAY_MS).toISOString(),
    anyBeforeIso: new Date(nowMs - ANY_NOTIFICATION_MAX_AGE_DAYS * DAY_MS).toISOString(),
  };
}

export interface NotificationAgeRow {
  is_read: boolean;
  created_at: string;
}

/** True when the row should be deleted: read and older than 90 days, or anything older than 365 days. */
export function shouldDeleteNotification(row: NotificationAgeRow, nowMs: number): boolean {
  const created = new Date(row.created_at).getTime();
  if (Number.isNaN(created)) return false;
  const age = nowMs - created;
  if (age > ANY_NOTIFICATION_MAX_AGE_DAYS * DAY_MS) return true;
  return row.is_read && age > READ_NOTIFICATION_MAX_AGE_DAYS * DAY_MS;
}

export function shouldRunNotificationRetention(lastRunAt: number | null, nowMs: number): boolean {
  return lastRunAt === null || nowMs - lastRunAt >= NOTIFICATION_RETENTION_INTERVAL_MS;
}
