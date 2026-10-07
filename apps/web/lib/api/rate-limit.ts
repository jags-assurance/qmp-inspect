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
