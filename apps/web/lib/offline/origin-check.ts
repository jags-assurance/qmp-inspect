/**
 * E-10: CSRF defence for the cookie-authenticated offline replay route (POST /api/offline-sync).
 *
 * A cross-site page can make a signed-in user's browser POST a multipart form to a same-site URL. This route
 * performs real writes (sign-offs, NCRs, completions), so a request is only accepted when it demonstrably
 * comes from this app's own pages:
 *  1. Sec-Fetch-Site (sent by all current browsers) must be "same-origin" when present;
 *  2. otherwise the Origin header must match this deployment's host (Host / X-Forwarded-Host, or the
 *     configured NEXT_PUBLIC_APP_URL);
 *  3. with neither header the caller is not a browser (browsers always send Origin on a cross-origin POST),
 *     so there is no ambient-cookie CSRF risk and the request is allowed.
 * On top of that the replay client always sends an X-Idempotency-Key header, which a plain cross-site HTML
 * form cannot set, so it is required as well.
 */

export interface OriginCheckInput {
  origin: string | null;
  secFetchSite: string | null;
  host: string | null;
  forwardedHost: string | null;
  /** NEXT_PUBLIC_APP_URL (or equivalent), if configured. */
  appUrl: string | null;
  idempotencyKey: string | null;
}

export type OriginCheckResult = { ok: true } | { ok: false; reason: string };

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkOfflineSyncOrigin(input: OriginCheckInput): OriginCheckResult {
  if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
    return { ok: false, reason: "Missing X-Idempotency-Key header." };
  }

  const site = input.secFetchSite?.trim().toLowerCase() ?? "";
  if (site) {
    return site === "same-origin" ? { ok: true } : { ok: false, reason: "Cross-site request refused." };
  }

  const origin = input.origin?.trim() ?? "";
  if (origin) {
    // "null" is sent from sandboxed iframes and some redirects: never trusted.
    const originHost = origin === "null" ? null : hostOf(origin);
    if (!originHost) return { ok: false, reason: "Request origin is not allowed." };
    const allowed = new Set([hostOf(input.host), hostOf(input.forwardedHost), hostOf(input.appUrl)].filter((h): h is string => !!h));
    return allowed.has(originHost) ? { ok: true } : { ok: false, reason: "Request origin is not allowed." };
  }

  return { ok: true };
}
