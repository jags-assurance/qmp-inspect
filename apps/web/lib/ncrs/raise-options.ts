import type { SupabaseClient } from "@supabase/supabase-js";
import { directoryClient } from "@/lib/ncrs/recipients";

export interface RaiseOptions {
  projects: { id: string; project_number: string; name: string }[];
  peopleByProject: Record<string, { id: string; name: string }[]>;
  partiesByProject: Record<string, { id: string; name: string; party_type: string }[]>;
}

interface ProjectRow {
  id: string;
  project_number: string;
  name: string;
  organization_id: string;
}
interface UserRow {
  id: string;
  full_name: string;
  email: string;
}
interface GrantRow {
  user_id: string;
  scope_type: "global" | "organization" | "project";
  organization_id: string | null;
  project_id: string | null;
}
interface LinkedPartyRow {
  project_id: string;
  user_id: string | null;
}
interface ResponsiblePartyRow {
  id: string;
  project_id: string;
  name: string;
  party_type: string;
}

/**
 * The real "people with access to this project" + "this project's parties" lists the NCR/Observation
 * form needs (access_grants scopes plus project_parties linked to a login — same resolution as
 * /inspect/ncrs/new). Extracted so the Observation register can fetch it lazily when its raise panel
 * opens, instead of paying for five extra queries and serialising every user/grant on every load.
 */
export async function loadNcrRaiseOptions(supabase: SupabaseClient): Promise<RaiseOptions> {
  // People lookups go through the directory client: a non-staff raiser can only read their own users /
  // grants rows, which left the assignee picker holding just themselves. Projects stay RLS-scoped.
  const dir = directoryClient(supabase);
  const [{ data: projects }, { data: users }, { data: grants }, { data: linked }, { data: parties }] = await Promise.all([
    supabase.from("projects").select("id, project_number, name, organization_id").order("name").returns<ProjectRow[]>(),
    dir.from("users").select("id, full_name, email").eq("is_active", true).order("full_name").returns<UserRow[]>(),
    dir.from("access_grants").select("user_id, scope_type, organization_id, project_id").returns<GrantRow[]>(),
    dir.from("project_parties").select("project_id, user_id").eq("is_active", true).not("user_id", "is", null).returns<LinkedPartyRow[]>(),
    supabase.from("project_parties").select("id, project_id, name, party_type").eq("is_active", true).order("name").returns<ResponsiblePartyRow[]>(),
  ]);

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const peopleByProject: RaiseOptions["peopleByProject"] = {};
  for (const p of projects ?? []) peopleByProject[p.id] = [];

  const addPerson = (projectId: string, userId: string) => {
    const list = peopleByProject[projectId];
    const user = userById.get(userId);
    if (!list || !user || list.some((e) => e.id === userId)) return;
    list.push({ id: user.id, name: user.full_name || user.email });
  };

  for (const grant of grants ?? []) {
    if (grant.scope_type === "global") {
      for (const p of projects ?? []) addPerson(p.id, grant.user_id);
    } else if (grant.scope_type === "organization" && grant.organization_id) {
      for (const p of projects ?? []) if (p.organization_id === grant.organization_id) addPerson(p.id, grant.user_id);
    } else if (grant.scope_type === "project" && grant.project_id) {
      addPerson(grant.project_id, grant.user_id);
    }
  }
  for (const party of linked ?? []) if (party.user_id) addPerson(party.project_id, party.user_id);
  for (const list of Object.values(peopleByProject)) list.sort((a, b) => a.name.localeCompare(b.name));

  const partiesByProject: RaiseOptions["partiesByProject"] = {};
  for (const p of projects ?? []) partiesByProject[p.id] = [];
  for (const party of parties ?? []) {
    partiesByProject[party.project_id]?.push({ id: party.id, name: party.name, party_type: party.party_type });
  }

  return {
    projects: (projects ?? []).map((p) => ({ id: p.id, project_number: p.project_number, name: p.name })),
    peopleByProject,
    partiesByProject,
  };
}
