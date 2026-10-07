// Pure parts of the sign-in throttle, kept free of server-only imports so they unit-test cleanly.
import { createHash } from "node:crypto";

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

/** Blocked once either counter reaches its limit. */
export function isThrottled(counts: { email: number; ip: number }, limits: ThrottleLimits): boolean {
  return counts.email >= limits.perEmail || counts.ip >= limits.perIp;
}

export function attemptKey(prefix: "email" | "ip", value: string): string {
  return `${prefix}:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
}
