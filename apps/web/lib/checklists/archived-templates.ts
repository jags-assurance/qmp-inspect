// Not a "use server" file. Best-effort read of archived template ids, kept separate from each
// page's main query so those queries are unchanged (and keep working) when the versioning
// migration (20261106000100, archived_at) has not been applied.
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHECKLIST_TEMPLATES_TABLE } from "./db-types";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function loadArchivedTemplateIds(supabase: Supabase): Promise<Set<string>> {
  const { data, error } = await supabase
    .from(CHECKLIST_TEMPLATES_TABLE)
    .select("id")
    .not("archived_at", "is", null)
    .limit(5000)
    .returns<{ id: string }[]>();
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.id));
}
