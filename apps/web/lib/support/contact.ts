/**
 * The support email shown on /inspect/support and the public pages (U8). It comes from the
 * NEXT_PUBLIC_SUPPORT_EMAIL environment variable; when that is unset or not a plausible address the
 * pages show a clearly marked placeholder instead of a made-up contact.
 */
export const SUPPORT_EMAIL_PLACEHOLDER = "[OWNER TO FILL: support email — set NEXT_PUBLIC_SUPPORT_EMAIL]";

const PLAUSIBLE_EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** The configured support address, or null when unset or malformed (never throws, never guesses). */
export function parseSupportEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  return PLAUSIBLE_EMAIL.test(value) ? value : null;
}

/** Reads the env var with a literal reference so Next inlines it into client bundles too. */
export function getSupportEmail(): string | null {
  return parseSupportEmail(process.env.NEXT_PUBLIC_SUPPORT_EMAIL);
}
