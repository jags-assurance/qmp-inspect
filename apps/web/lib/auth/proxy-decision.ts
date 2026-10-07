import { evaluateSession, type SessionLimitConfig } from "./session-limits";

export type ProxyDecision =
  | { action: "continue"; mustChangePassword: boolean | null }
  | { action: "sign_out"; reason: "deactivated" | "session_idle" | "session_expired" | "temp_password_expired" };

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
  /** ISO time after which a still-unchanged temporary password stops working (app_metadata). */
  tempPasswordExpiresAt?: string | null;
}): ProxyDecision {
  if (params.deactivated) return { action: "sign_out", reason: "deactivated" };
  if (params.mustChangePasswordClaim === true && params.tempPasswordExpiresAt) {
    const expires = Date.parse(params.tempPasswordExpiresAt);
    if (Number.isFinite(expires) && expires < params.now) return { action: "sign_out", reason: "temp_password_expired" };
  }
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
