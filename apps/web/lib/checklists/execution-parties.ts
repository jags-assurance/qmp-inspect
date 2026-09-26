import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";

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
    .select("allow_client_execution, organizations(engagement_scope)")
    .eq("id", projectId)
    .maybeSingle<{ allow_client_execution: boolean; organizations: { engagement_scope: string } | null }>();

  const types = new Set(BASE_EXECUTING_PARTY_TYPES);
  // Self-Managed/Platform-Only clients (organizations.engagement_scope) run every one of their own
  // projects end to end — JAGS only provides the platform — so this org-wide flag grants the same
  // client-execution right as the per-project allow_client_execution toggle, without needing an
  // Admin to flip it project-by-project. See supabase/migrations/
  // 20260918010000_self_managed_engagement_scope.sql.
  if (
    project?.allow_client_execution ||
    project?.organizations?.engagement_scope === "self_managed" ||
    project?.organizations?.engagement_scope === "client_managed"
  ) {
    types.add("client");
  }
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

/**
 * Whether the current session may execute (record evidence for) a given ITP item — staff always
 * can; otherwise only a party that (a) is actually a stakeholder on this specific activity
 * (activity_party_intervention), (b) is active, and (c) is an executing party type for this project
 * (BASE_EXECUTING_PARTY_TYPES, plus client when opted in — see getExecutingPartyTypes above).
 *
 * Originally private to lib/checklists/actions.ts as canExecuteChecklistForItem, generalized here
 * (same logic, same name minus "Checklist") once evidence_type=2/3 items (document upload,
 * measurement record — lib/itps/evidence-actions.ts) needed the identical rule: which party may
 * execute an activity doesn't depend on what KIND of evidence that activity produces, so this was a
 * duplication waiting to drift, not a checklist-specific concern.
 */
export async function canExecuteItpItem(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  itpItemId: string
): Promise<boolean> {
  const session = await requireSession();
  if (session.isJagsStaff) return true;

  const { data: stakeholderParties } = await supabase
    .from("activity_party_intervention")
    .select("project_parties(user_id, party_type, is_active)")
    .eq("itp_item_id", itpItemId)
    .returns<{ project_parties: { user_id: string | null; party_type: string; is_active: boolean } | null }[]>();

  const projectId = await findProjectIdForItpItem(supabase, itpItemId);
  const executingPartyTypes = projectId ? await getExecutingPartyTypes(supabase, projectId) : new Set<string>();

  return (stakeholderParties ?? []).some(
    (row) =>
      row.project_parties?.user_id === session.userId &&
      row.project_parties.is_active &&
      executingPartyTypes.has(row.project_parties.party_type)
  );
}
