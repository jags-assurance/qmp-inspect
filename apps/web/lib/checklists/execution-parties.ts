import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * R76: "the originator (typically the subcontractor/contractor) raises the inspection request" —
 * self-inspection is that party's own spec'd role. An independent verifier (TPI/lab) or the client
 * exists on the intervention grid to check someone else's work after the fact, not to do the field
 * data entry themselves — UNLESS a project has explicitly opted a client party into doing so via
 * projects.allow_client_execution (piece 4 of the teams/delegation work), for the "client's own team
 * occasionally handles inspection work" hybrid case. Shared by both the checklist page (UI gating)
 * and lib/checklists/actions.ts (the actual server-side execution gate) so the two can never drift.
 */
export const BASE_EXECUTING_PARTY_TYPES = new Set(["subcontractor", "main_contractor"]);

export async function getExecutingPartyTypes(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  projectId: string
): Promise<Set<string>> {
  const { data: project } = await supabase
    .from("projects")
    .select("allow_client_execution")
    .eq("id", projectId)
    .maybeSingle<{ allow_client_execution: boolean }>();

  const types = new Set(BASE_EXECUTING_PARTY_TYPES);
  if (project?.allow_client_execution) types.add("client");
  return types;
}

/** Resolves the project_id for an itp_item — needed by lib/checklists/actions.ts, which (unlike the
 *  checklist page) doesn't already have the project in hand when it checks execution rights. */
export async function findProjectIdForItpItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("itp_items")
    .select("itp_sections(itps(project_id))")
    .eq("id", itpItemId)
    .maybeSingle<{ itp_sections: { itps: { project_id: string } | null } | null }>();
  return data?.itp_sections?.itps?.project_id ?? null;
}
