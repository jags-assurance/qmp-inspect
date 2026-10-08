import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  evaluateSession,
  readSessionLimitConfig,
  sessionCookieSecret,
  signStamp,
  verifyStamp,
} from "@/lib/auth/session-limits";
import { decideProxyAccess } from "@/lib/auth/proxy-decision";
import { isPrefetchRequest } from "@/lib/auth/prefetch";
import { isMfaExemptPath, mfaChallengePath, mfaEnabled, needsMfaChallenge } from "@/lib/auth/mfa";

const PUBLIC_PATHS = [
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
  // PWA / offline-support assets: the browser fetches the service worker script (and installs the
  // manifest + offline fallback) without being able to follow a login redirect — "The script
  // resource is behind a redirect, which is disallowed" — so redirecting these to /login silently
  // broke offline mode on every device. They hold no user data.
  "/sw.js",
  "/manifest.webmanifest",
  "/offline.html",
];

// Signed "last seen" (inactivity limit) and "profile check passed" (skips a DB query per request)
// cookies — see lib/auth/session-limits.ts.
const SEEN_COOKIE = "qmp_seen";
const CHECK_COOKIE = "qmp_chk";
const SEEN_REFRESH_MS = 60_000; // re-stamp at most once a minute
const CHECK_TTL_MS = 5 * 60_000;
const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

function isPrefetch(request: NextRequest): boolean {
  return isPrefetchRequest(request.headers);
}

/**
 * Refreshes the Supabase session on every request (required by @supabase/ssr) and redirects
 * signed-out users away from anything but the public auth routes. This is a UX convenience, not
 * the security boundary — RLS is the actual boundary. A user who somehow reaches a page without a
 * valid session still gets zero rows back from every query.
 *
 * Also enforced here, server-side: an absolute session lifetime and an inactivity limit, a
 * deactivated (banned) account, and the forced first-login password change.
 *
 * Named `proxy` (not `middleware`) per Next.js 16's renamed convention — same request/response
 * lifecycle, the file is just called `proxy.ts` now.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Auth cookie writes must never be cached by a CDN/reverse proxy — otherwise one
          // user's session token can be served to a different user. @supabase/ssr hands us the
          // exact cache-control headers to apply; only the first write on a client carries them.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    }
  );

  // Every Link in the viewport fires a prefetch request through this proxy, and an Auth-server round trip
  // (getUser) per prefetch hammers a small shared Supabase project. A prefetch is never the enforcement
  // point (the real navigation is, and RLS is the boundary), so it only verifies the JWT locally with
  // getClaims() (JWKS-cached; refreshes an expiring session through the same cookie handler; falls back to a
  // server check only for a project on symmetric signing keys). Real requests still call getUser().
  const prefetch = isPrefetch(request);
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  let signedIn = false;
  if (prefetch) {
    const { data: claimsData } = await supabase.auth.getClaims();
    signedIn = Boolean(claimsData?.claims?.sub);
  } else {
    ({
      data: { user },
    } = await supabase.auth.getUser());
    signedIn = user !== null;
  }

  const pathname = request.nextUrl.pathname;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!signedIn && !isPublicPath) {
    const redirectUrl = new URL("/login", request.url);
    // Keep the query string so a deep link (?panel=…&status=…) survives sign-in; the login page and
    // signInAction re-validate it as a same-site path.
    redirectUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(redirectUrl);
  }

  // (A signed-in user sent back with ?error=... is shown the message instead of being bounced home,
  // which would loop for an account whose session context can no longer be built.)
  if (signedIn && pathname === "/login" && !request.nextUrl.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (user && !isPublicPath) {
    const now = Date.now();
    const secret = sessionCookieSecret();

    // Redirect that also carries any cookie writes made above (token refresh, sign-out).
    const redirectWithCookies = (to: string) => {
      const redirect = NextResponse.redirect(new URL(to, request.url));
      for (const c of response.cookies.getAll()) redirect.cookies.set(c);
      return redirect;
    };

    // ---- Two-step sign-in (off unless NEXT_PUBLIC_ENABLE_MFA=1): a session that has a verified
    // authenticator factor but has not passed the code step cannot reach anything but the challenge. ----
    if (mfaEnabled() && !isMfaExemptPath(pathname)) {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (needsMfaChallenge(aal)) return redirectWithCookies(mfaChallengePath(pathname + request.nextUrl.search));
    }

    // ---- Server-side session limits + deactivation ----
    const lastSignInAt = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : null;
    const lastSeen = secret ? await verifyStamp(secret, user.id, request.cookies.get(SEEN_COOKIE)?.value) : null;
    const bannedUntil = (user as { banned_until?: string | null }).banned_until;
    const decision = decideProxyAccess({
      now,
      lastSeen,
      lastSignInAt,
      limits: readSessionLimitConfig(),
      deactivated:
        user.app_metadata?.deactivated === true || (bannedUntil ? Date.parse(bannedUntil) > now : false),
      mustChangePasswordClaim:
        typeof user.app_metadata?.must_change_password === "boolean" ? user.app_metadata.must_change_password : null,
      tempPasswordExpiresAt:
        typeof user.app_metadata?.temp_password_expires_at === "string" ? user.app_metadata.temp_password_expires_at : null,
    });

    if (decision.action === "sign_out") {
      await supabase.auth.signOut();
      const redirect = redirectWithCookies(`/login?error=${decision.reason}`);
      redirect.cookies.delete(SEEN_COOKIE);
      redirect.cookies.delete(CHECK_COOKIE);
      return redirect;
    }

    // ---- Forced first-login password change ----
    // The flag lives in the auth user's app_metadata (set at provisioning, cleared on change), which
    // getUser() just returned — no database round trip. Migration 20261111000101 backfills the claim
    // for every existing account and defaults it for new ones (D-03), so the users query below is only
    // a safety net for an account that somehow lacks the claim; it is cached for a few minutes in a
    // signed cookie and skipped entirely on prefetches.
    let mustChange = decision.mustChangePassword;
    let setCheckCookie = false;
    if (mustChange === null) {
      const cached = secret ? await verifyStamp(secret, user.id, request.cookies.get(CHECK_COOKIE)?.value) : null;
      if (cached !== null && now - cached < CHECK_TTL_MS) {
        mustChange = false;
      } else if (prefetch) {
        mustChange = false; // a prefetch is never the enforcement point; the real navigation is.
      } else {
        const { data: profile } = await supabase
          .from("users")
          .select("must_change_password, is_active")
          .eq("id", user.id)
          .maybeSingle<{ must_change_password: boolean; is_active: boolean }>();
        if (profile && profile.is_active === false) {
          await supabase.auth.signOut();
          const redirect = redirectWithCookies("/login?error=deactivated");
          redirect.cookies.delete(SEEN_COOKIE);
          redirect.cookies.delete(CHECK_COOKIE);
          return redirect;
        }
        mustChange = Boolean(profile?.must_change_password);
        setCheckCookie = !mustChange;
      }
    }
    if (mustChange) {
      return redirectWithCookies("/reset-password?forced=1");
    }

    if (secret && !prefetch) {
      if (lastSeen === null || now - lastSeen > SEEN_REFRESH_MS) {
        response.cookies.set(SEEN_COOKIE, await signStamp(secret, user.id, now), COOKIE_OPTS);
      }
      if (setCheckCookie) {
        response.cookies.set(CHECK_COOKIE, await signStamp(secret, user.id, now), COOKIE_OPTS);
      }
    }
  }

  return response;
}

export const config = {
  // Static assets, the service worker, manifest and offline page never need a session round trip.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|woff2?)$).*)",
  ],
};
