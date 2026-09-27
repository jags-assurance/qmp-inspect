import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Table not in the generated Database type yet (same "cast to any" pattern as
// NUMBERING_CONFIGS_TABLE/NOTICE_PERIOD_CONFIGS_TABLE) — see 20260930110000's migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const INSPECTION_LOCATION_PRESETS_TABLE = "inspection_location_presets" as any;

export interface LocationPresetRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  name: string;
  sort_order: number;
}

/**
 * Union of this project's own presets and its organisation's project_id=null defaults — same
 * "org default, project override" precedence idea as notice_period_configs, except additive here
 * (a project's own list supplements the org list rather than replacing it) since presets are just
 * convenience shortcuts, not an authority setting with a single winning value.
 */
export async function getLocationPresetsForProject(
  supabase: SupabaseClient,
  organizationId: string,
  projectId: string
): Promise<LocationPresetRow[]> {
  const { data } = await supabase
    .from(INSPECTION_LOCATION_PRESETS_TABLE)
    .select("id, organization_id, project_id, name, sort_order")
    .eq("organization_id", organizationId)
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .order("sort_order")
    .returns<LocationPresetRow[]>();

  return data ?? [];
}
