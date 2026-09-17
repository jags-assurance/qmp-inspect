import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/auth/confirm",
  "/forgot-password",
  "/reset-password",
  // Health check must be reachable by uptime monitors / load balancers with no session.
  "/api/health",
];

// Requires a signed-in user (unlike the fully public paths above) but must itself be reachable
// *before* AAL2 is reached — otherwise a user who needs the challenge could never reach the page
// that lets them clear it.
const MFA_CHALLENGE_PATH = "/mfa/challenge";

/**
 * Refreshes the Supabase session on every request (required by @supabase/ssr) and redirects
 * signed-out users away from anything but the public auth routes. This is a UX convenience, not
 * the security boundary — RLS is the actual boundary. A user who somehow reaches a page without a
 * valid session still gets zero rows back from every query.
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // MFA gate: opt-in, not mandatory (see lib/auth/mfa-actions.ts / app/inspect/organisation/
  // security) — this only ever fires for an account that has itself enrolled a verified TOTP
  // factor, which is exactly what flips Supabase's `nextLevel` to aal2. Every other account is
  // unaffected. `currentLevel` reaches aal2 only after the /mfa/challenge page's
  // challengeAndVerify() call succeeds for *this* session.
  if (user && !isPublicPath) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsChallenge = aal && aal.nextLevel === "aal2" && aal.currentLevel !== aal.nextLevel;

    if (needsChallenge && request.nextUrl.pathname !== MFA_CHALLENGE_PATH) {
      return NextResponse.redirect(new URL(MFA_CHALLENGE_PATH, request.url));
    }
    if (!needsChallenge && request.nextUrl.pathname === MFA_CHALLENGE_PATH) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
