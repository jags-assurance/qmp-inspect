import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { ORGANIZATION_MODULE_LICENSES_TABLE } from "./types";
import { licenseCacheTag, toLicenseMap, type LicenseMap } from "./license-map";

/**
 * D-07: an organisation's module licences, cached. The /inspect layout used to run one query per
 * module (8 for a client login) on EVERY navigation, and registers/data-book/reports pages added
 * more; the whole set is one tiny read that changes only when a JAGS Admin flips a toggle.
 *
 * - `unstable_cache` shares the result across requests for 60s and is invalidated immediately by
 *   `revalidateTag(licenseCacheTag(orgId))` in setModuleLicenseAction.
 * - React `cache()` on top de-duplicates concurrent callers within one render (the layout asks for
 *   several keys at once), which unstable_cache alone does not.
 * - Reads with the service-role client for the same reason lib/master-disciplines/cache.ts does: a
 *   cached function must not depend on one request's cookies. The organisation id always comes from
 *   the caller's own access grants / a project they can already see, and the data is a boolean per
 *   module, so this exposes nothing the RLS-scoped read would not.
 *
 * Returns null when it cannot answer (service role not configured, query error); callers then fall
 * back to the plain RLS query, or fail open to "licensed". An error is thrown inside the cached
 * function so it is never cached.
 */
const loadCached = (organizationId: string) =>
  unstable_cache(
    async (): Promise<LicenseMap> => {
      const supabase = createSupabaseServiceRoleClient();
      const { data, error } = await supabase
        .from(ORGANIZATION_MODULE_LICENSES_TABLE)
        .select("module_key, is_licensed")
        .eq("organization_id", organizationId)
        .returns<{ module_key: string; is_licensed: boolean }[]>();
      if (error) throw new Error(`module licence read failed: ${error.message}`);
      return toLicenseMap(data);
    },
    ["org-module-licenses", organizationId],
    { revalidate: 60, tags: [licenseCacheTag(organizationId)] }
  )();

export const getOrgLicenseMap = cache(async (organizationId: string): Promise<LicenseMap | null> => {
  if (!isServiceRoleConfigured()) return null;
  try {
    return await loadCached(organizationId);
  } catch {
    return null;
  }
});
