import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ORGANIZATION_MODULE_LICENSES_TABLE, type ModuleKey } from "./types";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
 */
export async function isModuleLicensed(
  supabase: SupabaseClient,
  organizationId: string,
  moduleKey: ModuleKey
): Promise<boolean> {
  try {
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
