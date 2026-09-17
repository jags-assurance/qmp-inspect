import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@jags/shared-types";

/**
 * Server-side Supabase client for use in Server Components, Server Actions, and Route Handlers.
 * Runs with the anonymous key + the caller's session cookie — every query is still subject to
 * RLS, exactly as if the browser had made it. This is deliberate: the app never relies on an
 * application-layer "am I allowed to see this" check as the only line of defense.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        // Next.js patches the global `fetch` to run every request through its own Data
        // Cache/request-memoization layer unless told not to. That layer was observed to corrupt
        // a `.range()` query (PostgREST responds 206 Partial Content for those) — the exact
        // `count` came back correctly (from the Content-Range header) but the response body was
        // silently emptied, and only for range/paginated requests specifically, which is why this
        // was never hit before this app used `.range()` anywhere. Every query through this client
        // is already always-fresh, RLS-scoped, per-request data — nothing here should ever be
        // served from Next's cache — so caching is disabled unconditionally rather than only for
        // the one query type that happened to surface the bug.
        fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Note: the cache-control headers @supabase/ssr wants applied alongside a cookie write
          // can't be set from here (a Server Component/Action has no response object) — middleware
          // is the one place that actually applies them (see middleware.ts). This handler only
          // exists so a token refresh triggered mid-render doesn't throw.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component that can't set cookies — the middleware refreshes
            // the session on every request, so this is safe to ignore here.
          }
        },
      },
    }
  );
}
