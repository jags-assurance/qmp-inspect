import { hostname } from "node:os";

/**
 * Pure helpers for the multi-replica-safe job claim (F-04). The claim itself is the
 * `claim_next_background_job()` SQL function (supabase/migrations/20261111000103_*): one atomic
 * UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *, so two replicas
 * polling at the same instant each receive a DIFFERENT job (or none) instead of racing for the same
 * oldest row. These helpers only interpret what comes back, so they are unit-testable without a DB.
 */

export interface RpcError {
  code?: string | null;
  message?: string | null;
}

/**
 * True when the error means "this database function does not exist (yet)" — i.e. the migration has
 * not been applied — as opposed to a transient failure. PostgREST reports an unknown RPC as PGRST202
 * (or a 404), Postgres itself as 42883 (undefined_function).
 */
export function isRpcMissing(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("could not find the function") || (message.includes("function") && message.includes("does not exist"));
}

/**
 * A `returns setof background_jobs` RPC comes back as an array (0 or 1 rows); tolerate a bare object
 * (a single-row return shape) and null too. Anything without a string id is treated as "no job".
 */
export function parseClaimRpcResult<T extends { id: string }>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return typeof (row as { id?: unknown }).id === "string" ? (row as T) : null;
}

/** Stable-per-process identity for lease ownership (Railway exposes a replica id; fall back to host + pid). */
export function replicaId(
  env: Record<string, string | undefined> = process.env,
  host: string = hostname(),
  pid: number = process.pid
): string {
  const explicit = env.RAILWAY_REPLICA_ID || env.REPLICA_ID || env.HOSTNAME;
  return `${explicit && explicit.length > 0 ? explicit : host}:${pid}`;
}

/**
 * Lease TTL for a periodic sweep: a little shorter than the interval, so the next scheduled run can
 * always acquire it, but long enough that a second replica reaching the same tick cannot.
 */
export function sweepLeaseSeconds(intervalMs: number): number {
  return Math.max(30, Math.floor((intervalMs * 0.8) / 1000));
}
