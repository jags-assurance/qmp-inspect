import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { parseOverrides, type TermOverrides } from "./terms";

/**
 * The current terminology overrides (platform-wide, one row). Cached per request, so the layout, the
 * i18n helpers and the admin page share one query. Any failure (table not migrated yet, RLS, outage)
 * yields no overrides, i.e. the built-in defaults.
 */
export const loadTermOverrides = cache(async (): Promise<TermOverrides> => {
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
