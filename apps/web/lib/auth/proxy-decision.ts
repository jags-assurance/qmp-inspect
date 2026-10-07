import { evaluateSession, type SessionLimitConfig } from "./session-limits";

export type ProxyDecision =
  | { action: "continue"; mustChangePassword: boolean | null }
  | { action: "sign_out"; reason: "deactivated" | "session_idle" | "session_expired" };

/**
 * The pure part of proxy.ts's per-request decision for a signed-in user: end the session (account
 * deactivated, absolute lifetime exceeded, or idle too long), otherwise report what the auth user's
 * app_metadata already says about a forced password change (`null` = the claim is absent, so the
 * caller falls back to a profile query).
 */
export function decideProxyAccess(params: {
  now: number;
  lastSeen: number | null;
  lastSignInAt: number | null;
  limits: SessionLimitConfig;
  deactivated: boolean;
  mustChangePasswordClaim: boolean | null;
}): ProxyDecision {
  if (params.deactivated) return { action: "sign_out", reason: "deactivated" };
  const verdict = evaluateSession({
    now: params.now,
    lastSeen: params.lastSeen,
    lastSignInAt: params.lastSignInAt,
    config: params.limits,
  });
  if (verdict === "expired") return { action: "sign_out", reason: "session_expired" };
  if (verdict === "idle") return { action: "sign_out", reason: "session_idle" };
  return { action: "continue", mustChangePassword: params.mustChangePasswordClaim };
}
