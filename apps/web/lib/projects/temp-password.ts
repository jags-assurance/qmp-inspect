// Pure helpers for the temporary passwords issued when a party login is provisioned. Not a "use
// server" file (those may only export async functions), so the server action and unit tests both
// import from here.

import { randomBytes } from "node:crypto";

/** Default lifetime of a temporary password; override with TEMP_PASSWORD_TTL_HOURS. */
export const DEFAULT_TEMP_PASSWORD_TTL_HOURS = 72;

/**
 * A strong, single-use temporary password — 16 random bytes, base64url-encoded and trimmed to 22
 * characters, well past Supabase Auth's own minimum length. Never a fixed/shared "default password",
 * never reused across accounts, and never persisted anywhere in plain text beyond the one action
 * response that shows it to the admin.
 */
export function generateTempPassword(): string {
  return randomBytes(16).toString("base64url").slice(0, 22);
}

export function tempPasswordTtlMs(env: Record<string, string | undefined> = process.env): number {
  const hours = Number(env.TEMP_PASSWORD_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TEMP_PASSWORD_TTL_HOURS) * 3_600_000;
}

/** ISO timestamp after which the temporary password is no longer accepted (enforced in proxy.ts). */
export function tempPasswordExpiry(now = Date.now(), env: Record<string, string | undefined> = process.env): string {
  return new Date(now + tempPasswordTtlMs(env)).toISOString();
}

export function isTempPasswordExpired(expiresAtIso: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAtIso) return false;
  const t = Date.parse(expiresAtIso);
  return Number.isFinite(t) && t < now;
}
