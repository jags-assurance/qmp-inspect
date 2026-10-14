// Per-user request throttling for expensive /api route handlers (exports, bulk downloads, offline
// replay). Same intent as lib/auth/throttle.ts (bounded abuse of an endpoint) but in-memory instead
// of a DB table: these routes are hit by signed-in users, a per-instance sliding window is enough to
// stop a runaway script or a stuck client retry loop, and it adds no query to the hot path. On
// serverless the window is per warm instance, so the effective ceiling is limit x instances; that is
// an accepted trade-off. Sign-in/reset throttling stays DB-backed (lib/auth/throttle.ts).

import { NextResponse } from "next/server";

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  windowMs: number;
}

/** Named buckets so each route family has its own budget. */
export const API_RATE_LIMITS = {
  /** Offline outbox replay: one request per queued item, so a long queue bursts. */
  offlineSync: { limit: 240, windowMs: 60_000 },
  /** XLSX/DOCX/CSV exports: heavy queries + file generation. */
  export: { limit: 20, windowMs: 60_000 },
  /** Whole-vault ZIP downloads. */
  bulkDownload: { limit: 5, windowMs: 10 * 60_000 },
  /** Heavy classes below are also enforced across instances (SHARED_BUCKETS). */
  pdf: { limit: 10, windowMs: 60_000 },
  ai: { limit: 20, windowMs: 60_000 },
  handover: { limit: 3, windowMs: 10 * 60_000 },
  emailInbound: { limit: 120, windowMs: 60_000 },
  authAttempt: { limit: 10, windowMs: 5 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof API_RATE_LIMITS;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

const MAX_TRACKED_KEYS = 5_000;
const hits = new Map<string, number[]>();

/**
 * Sliding-window check. Records the hit when allowed. `now` is injectable for tests.
 */
export function checkRateLimit(bucket: string, key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  const mapKey = `${bucket}:${key}`;
  const cutoff = now - rule.windowMs;
  const recent = (hits.get(mapKey) ?? []).filter((t) => t > cutoff);
  if (recent.length >= rule.limit) {
    hits.set(mapKey, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0] + rule.windowMs - now) / 1000)) };
  }
  recent.push(now);
  hits.set(mapKey, recent);
  if (hits.size > MAX_TRACKED_KEYS) prune(cutoff);
  return { ok: true, retryAfterSec: 0 };
}

function prune(cutoff: number) {
  for (const [k, v] of hits) {
    if (v.length === 0 || v[v.length - 1] <= cutoff) hits.delete(k);
  }
  // Still over budget (all keys active): drop the oldest-inserted half rather than grow unbounded.
  if (hits.size > MAX_TRACKED_KEYS) {
    let n = Math.floor(hits.size / 2);
    for (const k of hits.keys()) {
      if (n-- <= 0) break;
      hits.delete(k);
    }
  }
}

export function resetRateLimits() {
  hits.clear();
}

/**
 * Route-handler helper: returns a 429 response when `userId` is over the bucket's budget, or null
 * to continue. Call it right after authentication so anonymous traffic is not tracked.
 */
export function rateLimitResponse(bucket: RateLimitBucket, userId: string): NextResponse | null {
  const result = checkRateLimit(bucket, userId, API_RATE_LIMITS[bucket]);
  if (result.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Too many requests. Please wait a moment and try again.", retryAfterSec: result.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } }
  );
}

// ---------------------------------------------------------------------------------------------
// Shared (DB-backed) layer for heavy routes. In-memory check runs first (free); only when it passes
// is the cross-instance counter consulted. Any fault falls back to the in-memory verdict (fail open).
// ---------------------------------------------------------------------------------------------

/** Buckets that also consult the shared counter. Ordinary read routes never do. */
export const SHARED_BUCKETS: ReadonlySet<RateLimitBucket> = new Set<RateLimitBucket>([
  "export",
  "bulkDownload",
  "pdf",
  "ai",
  "handover",
  "emailInbound",
  "authAttempt",
]);

/** Keys for one request: per-user (when known) and per-IP (when known). */
export function buildRateLimitKeys(bucket: string, userId: string | null | undefined, ip: string | null | undefined): string[] {
  const keys: string[] = [];
  if (userId) keys.push(`${bucket}:u:${userId}`);
  if (ip) keys.push(`${bucket}:ip:${ip}`);
  return keys;
}

/** Client IP from proxy headers (first x-forwarded-for hop), or null. */
export function clientIpFromHeaders(headers: Headers): string | null {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip")?.trim() || null;
}

export type SharedRpc = (key: string, limit: number, windowSeconds: number) => Promise<boolean>;

let warned = false;
export function resetSharedRateLimitWarning() {
  warned = false;
}

async function defaultRpc(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { createSupabaseServiceRoleClient, isServiceRoleConfigured } = await import("@/lib/supabase/service");
  if (!isServiceRoleConfigured()) throw new Error("service role not configured");
  const client = createSupabaseServiceRoleClient();
  // check_rate_limit is not in the generated types until they are regenerated.
  const { data, error } = await (client as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc("check_rate_limit", { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw new Error(error.message);
  if (typeof data !== "boolean") throw new Error("unexpected check_rate_limit result");
  return data;
}

/**
 * Hybrid check. ok=false when the in-memory limiter OR the shared counter (any per-user / per-IP key)
 * says the budget is spent. A missing/failing RPC logs one warning and keeps the in-memory verdict.
 */
export async function checkSharedRateLimit(
  bucket: RateLimitBucket,
  userId: string | null | undefined,
  ip: string | null | undefined,
  rpc: SharedRpc = defaultRpc
): Promise<RateLimitResult> {
  const rule: RateLimitRule = API_RATE_LIMITS[bucket];
  const local = userId ? checkRateLimit(bucket, userId, rule) : { ok: true, retryAfterSec: 0 };
  if (!local.ok || !SHARED_BUCKETS.has(bucket)) return local;
  const windowSeconds = Math.max(1, Math.ceil(rule.windowMs / 1000));
  try {
    for (const key of buildRateLimitKeys(bucket, userId, ip)) {
      // The IP key allows 5x the per-user budget so a shared office NAT is not punished.
      const limit = key.includes(":ip:") ? rule.limit * 5 : rule.limit;
      if (!(await rpc(key, limit, windowSeconds))) return { ok: false, retryAfterSec: windowSeconds };
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("[rate-limit] shared limiter unavailable, using per-instance limits:", err instanceof Error ? err.message : err);
    }
  }
  return local;
}

/** Async route helper for heavy routes: in-memory first, then the shared counter. */
export async function sharedRateLimitResponse(bucket: RateLimitBucket, userId: string, request?: Request): Promise<NextResponse | null> {
  const result = await checkSharedRateLimit(bucket, userId, request ? clientIpFromHeaders(request.headers) : null);
  if (result.ok) return null;
  return NextResponse.json(
    { ok: false, error: "Too many requests. Please wait a moment and try again.", retryAfterSec: result.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } }
  );
}
