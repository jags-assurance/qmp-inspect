import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ProjectSelectorOption } from "@/components/domain/global-project-selector";

/**
 * Projects for the header organisation / project picker: every project the signed-in login can see
 * (RLS-scoped), capped at 400, ordered by number.
 *
 * Cost notes (free-plan log budget): ONE query per request, de-duplicated with React `cache()` (keyed by
 * user id, so any other server component in the same request that asks for the picker list shares it),
 * selecting only the five fields the picker shows (the organisation name arrives via the embedded join,
 * so there is no second lookup).
 *
 * Deliberately NOT wrapped in `unstable_cache`: the result is access-scoped per user, the RLS client
 * depends on the request's cookies, and a cached copy would go stale on project create / rename / grant
 * changes (the actions that change it live outside the shell and do not revalidate a tag), which would
 * change what the user can see. Revisit if project actions gain a `revalidateTag`.
 */
export const loadHeaderProjectOptions = cache(async (userId: string): Promise<ProjectSelectorOption[]> => {
  void userId; // cache key only: the RLS-scoped client below is already the signed-in user's
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("projects")
    .select("id, project_number, name, organization_id, organizations(name)")
    .order("project_number", { ascending: true })
    .limit(400)
    .returns<{ id: string; project_number: string; name: string; organization_id: string; organizations: { name: string } | null }[]>();
  return (data ?? []).map((p) => ({
    id: p.id,
    number: p.project_number,
    name: p.name,
    orgId: p.organization_id,
    orgName: p.organizations?.name ?? "Organisation",
  }));
});
