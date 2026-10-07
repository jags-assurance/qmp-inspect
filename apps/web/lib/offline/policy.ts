// Pure outbox policy (no browser APIs) so the retry/ownership rules can be unit-tested.

/** Server-confirmed failures (5xx) allowed before an item needs the user's attention. */
export const MAX_SERVER_FAILURES = 5;
/** Items queued longer than this are flagged: browsers may evict idle site storage (iOS ~7 days). */
export const STALE_QUEUE_DAYS = 3;

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Exponential backoff: 30s, 1m, 2m, 4m ... capped at 30 minutes. `failures` is the count so far (>= 1). */
export function backoffMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

export type FailureClass =
  /** The server answered and said no (validation / permission): needs the user. */
  | "rejected"
  /** Another writer changed the same row. */
  | "conflict"
  /** Signed out / session expired. */
  | "auth"
  /** The request was too big for the host (platform 413): can never succeed as-is. */
  | "too_large"
  /** The server errored (5xx): counts towards the retry budget, with backoff. */
  | "server"
  /** No answer at all (offline, timeout, captive portal): never counts towards the budget. */
  | "network";

export function classifyHttpFailure(status: number, parsedBody: boolean): FailureClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 409) return "conflict";
  if (status === 413) return "too_large";
  if (status === 400 || status === 422) return "rejected";
  // A 5xx with an unparseable body usually comes from a gateway or captive portal, not our handler.
  if (status >= 500 && !parsedBody) return "network";
  return "server";
}

/** Whether an item whose owner is `itemUserId` may be replayed by `currentUserId`. Unowned (legacy) items replay. */
export function mayReplayItem(itemUserId: string | undefined | null, currentUserId: string | null): boolean {
  if (!itemUserId) return true;
  if (!currentUserId) return false;
  return itemUserId === currentUserId;
}

/** Whole days an item has been queued. */
export function queueAgeDays(createdAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - createdAt) / 86_400_000));
}

export function isStaleItem(createdAt: number, now: number = Date.now()): boolean {
  return queueAgeDays(createdAt, now) >= STALE_QUEUE_DAYS;
}

/** The (inspection record, checklist item) an answer targets, or null for other kinds. */
export function responseKey(item: { kind: string; fields: Record<string, string> }): string | null {
  if (item.kind !== "checklist_response") return null;
  const rec = item.fields.inspection_record_id;
  const it = item.fields.checklist_item_id;
  return rec && it ? `${rec}:${it}` : null;
}

/**
 * Parses a client-supplied capture time. Returns an ISO string only when it is a real date that is
 * not in the future (beyond a small clock skew) and not older than `maxAgeDays`; otherwise null so
 * the caller falls back to the server clock.
 */
export function boundedCapturedAt(raw: string | null | undefined, now: number = Date.now(), maxAgeDays = 30): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  if (t > now + 5 * 60_000) return null;
  if (t < now - maxAgeDays * 86_400_000) return null;
  return new Date(t).toISOString();
}

/** Short human age for a queued item: "just now", "12 min", "3 h", "2 days". */
export function formatQueueAge(createdAt: number, now: number = Date.now()): string {
  const ms = Math.max(0, now - createdAt);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}
