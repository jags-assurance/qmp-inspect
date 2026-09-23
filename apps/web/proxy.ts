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

  // Forced first-login password change: a party login provisioned with a temporary password
  // (lib/projects/party-provisioning.ts) must set a real one before reaching anywhere else — this
  // is the actual enforcement point, not just a UI nudge (see guard_must_change_password,
  // 20260929010000_party_login_provisioning.sql, for why the flag itself can't just be cleared by
  // the client). A public path already lets a signed-in user reach /reset-password itself; every
  // other route redirects there first. One extra query per request for a signed-in user, same cost
  // class as the auth.getUser() call already made above.
  if (user && !isPublicPath) {
    const { data: profile } = await supabase.from("users").select("must_change_password").eq("id", user.id).maybeSingle();
    if (profile?.must_change_password) {
      return NextResponse.redirect(new URL("/reset-password?forced=1", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
