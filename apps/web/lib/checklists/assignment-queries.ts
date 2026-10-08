// Server-only reads for per-person assignment (not "use server": plain helpers).
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { directoryClient, projectPeople } from "@/lib/ncrs/recipients";
import { PROJECT_PARTY_MEMBERS_TABLE } from "@/lib/projects/party-access-types";
import { canAssignActivity } from "./assignment-logic";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AssigneeOption {
  id: string;
  name: string;
}

/** People an activity may be assigned to: JAGS staff on the project plus members of the activity's parties. */
export async function loadAssigneeOptions(
  supabase: Supabase,
  p: { itpItemId: string; projectId: string; organizationId: string }
): Promise<AssigneeOption[]> {
  const db = directoryClient(supabase);
  const people = await projectPeople(supabase, p.projectId, p.organizationId);
  if (people.length === 0) return [];
  const { data: parties } = await db
    .from("activity_party_intervention")
    .select("project_parties(id, user_id, is_active)")
    .eq("itp_item_id", p.itpItemId)
    .returns<{ project_parties: { id: string; user_id: string | null; is_active: boolean } | null }[]>();
  const partyUserIds = new Set<string>();
  const partyIds: string[] = [];
  for (const row of parties ?? []) {
    if (!row.project_parties?.is_active) continue;
    partyIds.push(row.project_parties.id);
    if (row.project_parties.user_id) partyUserIds.add(row.project_parties.user_id);
  }
  if (partyIds.length > 0) {
    const { data: members } = await db.from(PROJECT_PARTY_MEMBERS_TABLE).select("user_id").in("project_party_id", partyIds);
    for (const m of (members ?? []) as { user_id: string | null }[]) if (m.user_id) partyUserIds.add(m.user_id);
  }
  const { data: staff } = await db
    .from("users")
    .select("id")
    .in("id", people.map((x) => x.id))
    .eq("is_jags_staff", true)
    .returns<{ id: string }[]>();
  const staffIds = new Set((staff ?? []).map((s) => s.id));
  return people.filter((x) => staffIds.has(x.id) || partyUserIds.has(x.id));
}

/** Whether the viewer may assign this activity (mirrors assign_activity_to_user's caller rule). */
export async function viewerCanAssign(
  supabase: Supabase,
  p: { userId: string; isStaff: boolean; itpItemId: string; projectId: string }
): Promise<boolean> {
  if (p.isStaff) return true;
  const [{ data: assignments }, { data: parties }] = await Promise.all([
    supabase.from("client_team_project_assignments").select("client_team_id").eq("project_id", p.projectId),
    supabase
      .from("activity_party_intervention")
      .select("project_parties(user_id, is_active)")
      .eq("itp_item_id", p.itpItemId)
      .returns<{ project_parties: { user_id: string | null; is_active: boolean } | null }[]>(),
  ]);
  const teamIds = (assignments ?? []).map((a) => a.client_team_id);
  let isLead = false;
  if (teamIds.length > 0) {
    const { data: lead } = await supabase
      .from("client_team_members")
      .select("client_team_id")
      .eq("user_id", p.userId)
      .eq("is_team_lead", true)
      .in("client_team_id", teamIds)
      .limit(1);
    isLead = (lead ?? []).length > 0;
  }
  const isContact = (parties ?? []).some((r) => r.project_parties?.is_active && r.project_parties.user_id === p.userId);
  return canAssignActivity({ isStaff: false, isClientTeamLead: isLead, isExecutingPartyContact: isContact });
}
