// The signed-out allow list used by proxy.ts. Kept in its own module so it can be unit tested:
// anything listed here is reachable with no session, so every addition must be deliberate.

/** Prefix matches (a path that starts with one of these is public). */
export const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/auth/confirm",
  "/forgot-password",
  "/reset-password",
  // Public QR verification of handover certificates / IRNs (unguessable token, minimal facts only).
  "/verify/",
  // Health check must be reachable by uptime monitors / load balancers with no session.
  "/api/health",
  // Inbound-email webhook: authenticated by its own shared secret, not a user session.
  "/api/vault/email-inbound",
  // Scheduled sign-off automation: Vercel Cron has no user session; the route checks CRON_SECRET itself.
  "/api/cron/signoff-automation",
  // PWA / offline-support assets: the browser fetches the service worker script (and installs the
  // manifest + offline fallback) without being able to follow a login redirect — "The script
  // resource is behind a redirect, which is disallowed" — so redirecting these to /login silently
  // broke offline mode on every device. They hold no user data.
  "/sw.js",
  "/manifest.webmanifest",
  "/offline.html",
] as const;

/**
 * Exact matches (no prefix): the static privacy notice and terms of use. They hold no user data and
 * must be readable before signing in (a person is entitled to read them before accepting them).
 * Exact on purpose, so a future /privacy-something or /terms/… route is NOT silently public.
 */
export const PUBLIC_EXACT_PATHS = ["/privacy", "/terms"] as const;

export function isPublicPath(pathname: string): boolean {
  const normalised = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if ((PUBLIC_EXACT_PATHS as readonly string[]).includes(normalised)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
