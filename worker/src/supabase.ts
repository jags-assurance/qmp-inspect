import { createClient } from "@supabase/supabase-js";
import type { Database } from "@jags/shared-types";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. The worker talks to Supabase with the " +
      "service-role key (bypasses RLS by design — it only ever processes jobs it enqueued itself)."
  );
}

export const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false },
});
