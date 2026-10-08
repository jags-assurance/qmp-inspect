import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { TERMS_VERSION } from "./constants";
import { needsTermsAcceptance, type TermsRow } from "./logic";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Whether to show the acceptance banner to this user. Fails closed to "do not show": before migration
 * 20261128000100 is applied the columns do not exist, and any other error must never put a banner (or
 * anything else) between a person and their work.
 */
export async function loadNeedsTermsAcceptance(supabase: Supabase, userId: string): Promise<boolean> {
  try {
    const { data, error } = await untypedFrom(supabase, "users")
      .select("terms_accepted_at, terms_version")
      .eq("id", userId)
      .maybeSingle<TermsRow>();
    if (error) {
      if (!isMissingSchemaError(error)) console.error("[terms] could not read acceptance status:", error.message);
      return false;
    }
    return needsTermsAcceptance(data, TERMS_VERSION);
  } catch (err) {
    console.error("[terms] could not read acceptance status:", err);
    return false;
  }
}
