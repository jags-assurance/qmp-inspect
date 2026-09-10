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
