// App-level throttling for sign-in and password-reset requests, on top of whatever Supabase Auth
// enforces itself. Failures are counted in public.auth_attempts (service role only; see
// 20261104000400_auth_attempts_throttle.sql). Every function here degrades to "allowed" when the
// service role isn't configured or the table doesn't exist yet, so nothing breaks before the
// migration is applied — the throttle simply isn't active until then.

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";

export type ThrottleKind = "signin" | "reset";

export interface ThrottleLimits {
  windowMinutes: number;
  perEmail: number;
  perIp: number;
}

export const THROTTLE_LIMITS: Record<ThrottleKind, ThrottleLimits> = {
  signin: { windowMinutes: 15, perEmail: 5, perIp: 30 },
  reset: { windowMinutes: 60, perEmail: 3, perIp: 15 },
};

/** Pure decision, unit-tested: blocked once either counter reaches its limit. */
export function isThrottled(counts: { email: number; ip: number }, limits: ThrottleLimits): boolean {
  return counts.email >= limits.perEmail || counts.ip >= limits.perIp;
}

export function attemptKey(prefix: "email" | "ip", value: string): string {
  return `${prefix}:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

const MISSING_CODES = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);

export async function checkThrottle(kind: ThrottleKind, email: string): Promise<{ blocked: boolean }> {
  if (!isServiceRoleConfigured()) return { blocked: false };
  try {
    const limits = THROTTLE_LIMITS[kind];
    const since = new Date(Date.now() - limits.windowMinutes * 60_000).toISOString();
    const service = createSupabaseServiceRoleClient();
    const count = async (key: string) => {
      const { count: n, error } = await service
        .from("auth_attempts" as never)
        .select("id", { count: "exact", head: true })
        .eq("key", key)
        .eq("kind", kind)
        .gte("created_at", since);
      if (error) {
        if (!MISSING_CODES.has(error.code ?? "")) console.error(`[auth] throttle count failed: ${error.message}`);
        return 0;
      }
      return n ?? 0;
    };
    const [emailCount, ipCount] = await Promise.all([count(attemptKey("email", email)), count(attemptKey("ip", await clientIp()))]);
    return { blocked: isThrottled({ email: emailCount, ip: ipCount }, limits) };
  } catch (err) {
    console.error("[auth] throttle check failed:", err instanceof Error ? err.message : err);
    return { blocked: false };
  }
}

/** Records one attempt (a failed sign-in, or any reset request). Best-effort. */
export async function recordAttempt(kind: ThrottleKind, email: string): Promise<void> {
  if (!isServiceRoleConfigured()) return;
  try {
    const service = createSupabaseServiceRoleClient();
    const ip = await clientIp();
    const { error } = await service.from("auth_attempts" as never).insert([
      { key: attemptKey("email", email), kind },
      { key: attemptKey("ip", ip), kind },
    ] as never);
    if (error && !MISSING_CODES.has(error.code ?? "")) console.error(`[auth] throttle record failed: ${error.message}`);
    // Opportunistic cleanup so the table stays small without a scheduled job.
    if (Math.random() < 0.02) {
      await service
        .from("auth_attempts" as never)
        .delete()
        .lt("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString());
    }
  } catch (err) {
    console.error("[auth] throttle record failed:", err instanceof Error ? err.message : err);
  }
}

/** A successful sign-in forgives earlier failures for that email. */
export async function clearAttempts(kind: ThrottleKind, email: string): Promise<void> {
  if (!isServiceRoleConfigured()) return;
  try {
    await createSupabaseServiceRoleClient()
      .from("auth_attempts" as never)
      .delete()
      .eq("key", attemptKey("email", email))
      .eq("kind", kind);
  } catch {
    // Best-effort.
  }
}
