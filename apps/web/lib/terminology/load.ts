import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceRoleClient, isServiceRoleConfigured } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { parseOverrides, type TermOverrides } from "./terms";

/**
 * The current terminology overrides (platform-wide, one row). Cached per request, so the layout, the
 * i18n helpers and the admin page share one query. Any failure (table not migrated yet, RLS, outage)
 * yields no overrides, i.e. the built-in defaults.
 */
const TERMINOLOGY_TAG = "terminology";

/** Shared across requests for an hour; the save/reset action expires it at once (revalidateTag). Throws on any
 *  failure so a bad read is never cached. Service-role read: the row is platform-wide, identical for every user. */
const readSharedOverrides = unstable_cache(
  async (): Promise<unknown> => {
    if (!isServiceRoleConfigured()) throw new Error("service role not configured");
    const { data, error } = await untypedFrom(createSupabaseServiceRoleClient(), "terminology_settings")
      .select("terms")
      .eq("id", true)
      .maybeSingle<{ terms: unknown }>();
    if (error) throw new Error(error.message);
    return data?.terms ?? null;
  },
  ["terminology-overrides"],
  { revalidate: 3600, tags: [TERMINOLOGY_TAG] }
);

export const loadTermOverrides = cache(async (): Promise<TermOverrides> => {
  try {
    return parseOverrides(await readSharedOverrides());
  } catch {
    // Not cached or not configured: read it the ordinary way for this request.
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await untypedFrom(supabase, "terminology_settings")
      .select("terms")
      .eq("id", true)
      .maybeSingle<{ terms: unknown }>();
    if (error) {
      if (!isMissingSchemaError(error)) console.error(`[terminology] load failed: ${error.message}`);
      return {};
    }
    return parseOverrides(data?.terms);
  } catch {
    return {};
  }
});

export const TERMINOLOGY_CACHE_TAG = TERMINOLOGY_TAG;
