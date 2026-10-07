import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ORGANIZATION_MODULE_LICENSES_TABLE, type ModuleKey } from "./types";
import { getOrgLicenseMap } from "./cache";
import { isLicensedIn, toLicenseMap, type LicenseMap } from "./license-map";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * All of an org's explicit licence rows as one map, in a single read: from the shared per-org cache
 * when it can answer, otherwise one RLS-scoped query. null (both failed) means "unknown", which
 * callers read as licensed (fail open) via isLicensedIn().
 */
export async function getLicenseMap(supabase: SupabaseClient, organizationId: string): Promise<LicenseMap | null> {
  try {
    const cached = await getOrgLicenseMap(organizationId);
    if (cached) return cached;
    const { data, error } = await supabase
      .from(ORGANIZATION_MODULE_LICENSES_TABLE)
      .select("module_key, is_licensed")
      .eq("organization_id", organizationId)
      .returns<{ module_key: string; is_licensed: boolean }[]>();
    if (error) return null;
    return toLicenseMap(data);
  } catch {
    return null;
  }
}

/**
 * Whether `organizationId` is licensed for `moduleKey` — R112 per-client module licensing
 * (supabase/migrations/20260922080000_module_licensing.sql).
 *
 * FAIL OPEN, ALWAYS: this app has zero paying customers today, so there is no world in which a
 * missing row or a transient query error should ever lock a real org out of a module it never had
 * revoked. A module is only ever unlicensed by an EXPLICIT `is_licensed = false` row a JAGS Admin
 * wrote via the settings page. No row at all, or any error reading one (RLS denial the caller
 * shouldn't have hit, a network blip, the table not yet existing on some stale replica, etc.) both
 * resolve to licensed = true. Never invert this default to fail-closed.
 *
 * D-07: answered from the per-org cached licence map (lib/module-licensing/cache.ts, 60s, tagged and
 * invalidated on toggle) so a page with several checks costs at most one query per minute per org.
 * Only when the cache cannot answer does it fall back to the original single-row RLS query.
 */
export async function isModuleLicensed(
  supabase: SupabaseClient,
  organizationId: string,
  moduleKey: ModuleKey
): Promise<boolean> {
  try {
    const cached = await getOrgLicenseMap(organizationId);
    if (cached) return isLicensedIn(cached, moduleKey);

    const { data, error } = await supabase
      .from(ORGANIZATION_MODULE_LICENSES_TABLE)
      .select("is_licensed")
      .eq("organization_id", organizationId)
      .eq("module_key", moduleKey)
      .maybeSingle<{ is_licensed: boolean }>();

    if (error || !data) return true;
    return data.is_licensed !== false;
  } catch {
    return true;
  }
}
