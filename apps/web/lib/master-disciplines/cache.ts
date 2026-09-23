import { unstable_cache } from "next/cache";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";

export interface MasterDisciplineRow {
  id: string;
  code: string;
  name: string;
}

/**
 * master_disciplines is global, non-tenant-scoped reference data (its own RLS policy is a plain
 * open SELECT for any authenticated user — confirmed in the R121 full RLS sweep) that changes on
 * the order of "once a month" at an admin's own discretion, yet was being re-fetched fresh on
 * nearly every ITP/NCR/observation/checklist-library/KPI page render — 15 separate call sites, the
 * single most-repeated identical query in the app (found in a 2026-09-23 performance audit).
 *
 * Cached for 5 minutes via Next's unstable_cache. Uses the service-role client rather than the
 * normal per-request cookie-bound one deliberately: unstable_cache's callback must be safe to run
 * outside any one request's context (its result is reused across different users' requests), which
 * rules out a cookie-dependent client — and since the data is identical for every caller regardless
 * of session (open-read reference data, not tenant data), a service-role read here is exactly as
 * safe as the RLS-scoped read it replaces, just able to be shared across requests.
 */
export const getActiveMasterDisciplines = unstable_cache(
  async (): Promise<MasterDisciplineRow[]> => {
    if (!isServiceRoleConfigured()) {
      // Defensive fallback only — every real deployment has the service role key configured (it's
      // required for other features too, e.g. the email-inbound webhook). Returning an empty list
      // rather than throwing keeps a page rendering (just without discipline filters) instead of a
      // hard 500 in the unlikely case this env var is ever missing.
      return [];
    }
    const supabase = createSupabaseServiceRoleClient();
    const { data } = await supabase
      .from("master_disciplines")
      .select("id, code, name")
      .eq("is_active", true)
      .order("sort_order")
      .returns<MasterDisciplineRow[]>();
    return data ?? [];
  },
  ["active-master-disciplines"],
  { revalidate: 300, tags: ["master-disciplines"] }
);
