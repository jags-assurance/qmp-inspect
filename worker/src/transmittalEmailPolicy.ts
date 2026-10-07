// S7-26: retry policy for transmittal emails in email_outbox. Pure (no database / env access) so it
// unit-tests cleanly; the sweep that uses it lives in emailOutbox.ts.

/** After this many failed attempts (the web app's immediate send counts as the first) the email is given up on. */
export const MAX_TRANSMITTAL_ATTEMPTS = 5;

const MINUTE_MS = 60_000;
/** Wait before attempt N+1, indexed by attempts already made (1-based): 5 min, 15 min, 1 h, 4 h. */
const BACKOFF_MS = [5 * MINUTE_MS, 15 * MINUTE_MS, 60 * MINUTE_MS, 240 * MINUTE_MS];

export function transmittalRetryDelayMs(attemptsMade: number): number {
  const index = Math.min(Math.max(attemptsMade, 1), BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

export interface OutboxState {
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
}

/** Whether the worker should try to send this outbox row now. */
export function isTransmittalDue(row: OutboxState, now: number): boolean {
  if (row.status !== "pending") return false;
  if (row.attempts >= MAX_TRANSMITTAL_ATTEMPTS) return false;
  if (!row.nextAttemptAt) return true;
  const at = Date.parse(row.nextAttemptAt);
  return !Number.isFinite(at) || at <= now;
}

export interface FailureOutcome {
  status: "pending" | "failed";
  attempts: number;
  /** Set while the row stays pending. */
  nextAttemptAt: string | null;
}

/** What to record after a failed send attempt. */
export function outcomeAfterFailure(attemptsBefore: number, now: number): FailureOutcome {
  const attempts = attemptsBefore + 1;
  if (attempts >= MAX_TRANSMITTAL_ATTEMPTS) return { status: "failed", attempts, nextAttemptAt: null };
  return { status: "pending", attempts, nextAttemptAt: new Date(now + transmittalRetryDelayMs(attempts)).toISOString() };
}

/** Error text stored on the rows: bounded, single line, no key material. */
export function sanitizeEmailError(message: string): string {
  return message.replace(/\s+/g, " ").replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]").slice(0, 500);
}
