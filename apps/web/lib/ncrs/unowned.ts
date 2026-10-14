// Who is told when an NCR is raised with no owner (no assignee and no responsible party).
import type { SupabaseClient } from "@supabase/supabase-js";
import { directoryClient, staffVerifierIds } from "./recipients";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any>;

/** Pure: the project's team leads if any, otherwise the JAGS admin staff; never the person who raised it; de-duplicated. */
export function pickUnownedNcrRecipients(teamLeadIds: string[], staffIds: string[], raisedBy: string | null | undefined): string[] {
  const chosen = teamLeadIds.length > 0 ? teamLeadIds : staffIds;
  return [...new Set(chosen)].filter((id) => id && id !== raisedBy);
}

/** Pure: de-duplicated recipients for an NCR withdrawal - raiser, owner, party members and project team leads, never the actor. */
export function pickWithdrawRecipients(ids: Array<string | null | undefined>, actorId: string | null | undefined): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id !== actorId))];
}

export const UNOWNED_NCR_TITLE = "NCR raised without an owner";

/** JAGS team leads of the teams assigned to a project (best-effort, [] on failure). */
export async function projectTeamLeadIds(supabase: AnyClient, projectId: string): Promise<string[]> {
  try {
    const db = directoryClient(supabase);
    const { data: assigns } = await db.from("team_project_assignments").select("team_id").eq("project_id", projectId);
    const teamIds = ((assigns ?? []) as { team_id: string }[]).map((a) => a.team_id);
    if (teamIds.length === 0) return [];
    const { data: rows } = await db.from("team_members").select("user_id").in("team_id", teamIds).eq("is_team_lead", true);
    return ((rows ?? []) as { user_id: string }[]).map((r) => r.user_id);
  } catch {
    return [];
  }
}

/** Resolves the recipients for an ownerless NCR on a project (best-effort, returns [] on any failure). */
export async function unownedNcrRecipients(supabase: AnyClient, projectId: string, raisedBy: string | null | undefined): Promise<string[]> {
  try {
    const leads = await projectTeamLeadIds(supabase, projectId);
    return pickUnownedNcrRecipients(leads, await staffVerifierIds(supabase), raisedBy);
  } catch {
    return [];
  }
}
