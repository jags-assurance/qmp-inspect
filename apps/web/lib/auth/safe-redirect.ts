// Pure helper (no server-only imports) so the proxy, route handlers, server actions and unit tests
// all share one definition of "a redirect target we are willing to follow".

const MAX_NEXT_LENGTH = 512;

/**
 * Returns `raw` only when it is a same-site path: a single leading "/", not "//" (protocol-relative)
 * and not "/\" (browsers treat a backslash like a slash), no control characters, and not so long it
 * could be abusive. Anything else — including absolute URLs, `@evil.example`, `javascript:` — falls
 * back. Auth pages themselves are never a valid destination (it would loop).
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  // A path may legitimately contain a colon later on, but "/..:" style tricks and encoded slashes at
  // the start are not something we ever generate, so refuse an encoded leading slash/backslash.
  if (/^\/(?:%2f|%5c)/i.test(raw)) return fallback;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login/")) return fallback;
  return raw;
}
