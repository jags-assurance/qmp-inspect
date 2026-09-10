import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@jags/shared-types";

/** Browser-side Supabase client, for use in Client Components. Subject to RLS like any other. */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
