"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { loadNcrRaiseOptions, type RaiseOptions } from "@/lib/ncrs/raise-options";

/** Fetched on demand when a raise panel opens — RLS on the underlying tables still scopes the result. */
export async function loadRaiseOptionsAction(): Promise<RaiseOptions> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  return loadNcrRaiseOptions(supabase);
}
