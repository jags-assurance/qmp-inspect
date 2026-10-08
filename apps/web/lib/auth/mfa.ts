// S1-10: two-step sign-in (TOTP) helpers. Pure, no Supabase or env access beyond the flag, so they unit-test
// cleanly. MFA is OFF unless NEXT_PUBLIC_ENABLE_MFA=1; with it off nothing about sign-in changes.

export function mfaEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_ENABLE_MFA === "1";
}

export interface AalState {
  currentLevel: string | null;
  nextLevel: string | null;
}

/** The session still has to pass the authenticator-app step: the user has a verified factor but this session is below AAL2. */
export function needsMfaChallenge(aal: AalState | null | undefined): boolean {
  return !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
}

/** A TOTP code is exactly six digits (spaces typed for readability are allowed). */
export function normaliseTotpCode(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Where the proxy sends a session that still owes the authenticator step. */
export function mfaChallengePath(next: string): string {
  return `/login/mfa?next=${encodeURIComponent(next)}`;
}

/** Paths a below-AAL2 session may still reach: the challenge itself and the sign-out/auth plumbing. */
export function isMfaExemptPath(pathname: string): boolean {
  return pathname === "/login/mfa" || pathname.startsWith("/auth/") || pathname === "/api/health";
}
