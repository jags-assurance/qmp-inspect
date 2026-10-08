/**
 * Offline replay / double-submit idempotency. The client key is stored on the record itself
 * (ncrs.request_id, unique per project), so the database is the single arbiter of "already created".
 */
export function sanitizeClientKey(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
}
