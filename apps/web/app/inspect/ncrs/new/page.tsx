import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { NewNcrForm } from "./new-ncr-form";

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

interface PartyRow {
  project_id: string;
  user_id: string | null;
}

interface ResponsiblePartyRow {
  id: string;
  project_id: string;
  name: string;
  party_type: string;
}

export default async function NewNcrPage({
  searchParams,
}: {
  searchParams: Promise<{
    project_id?: string;
    itp_item_id?: string;
    inspection_record_id?: string;
    description?: string;
  }>;
}) {
  await requireSession();
  const params = await searchParams;

  const supabase = await createSupabaseServerClient();

  // Round-table finding: assignment used to be a free-text field with no guarantee the value was
  // even a real user. Build the real "people with access to this project" list the same way
  // access is actually granted elsewhere in the app — access_grants (global/organization/project
  // staff scopes, see app/inspect/organisation/staff-access/page.tsx) plus project_parties rows
  // linked to a login (see project_parties.user_id, itps/[id]/page.tsx) — rather than inventing a
  // new notion of "project membership".
  const [{ data: projects }, { data: users }, { data: grants }, { data: parties }, { data: responsibleParties }] = await Promise.all([
    supabase.from("projects").select("id, project_number, name, organization_id").order("name").returns<ProjectRow[]>(),
    supabase.from("users").select("id, full_name, email").eq("is_active", true).order("full_name").returns<UserRow[]>(),
    supabase.from("access_grants").select("user_id, scope_type, organization_id, project_id").returns<GrantRow[]>(),
    supabase
      .from("project_parties")
      .select("project_id, user_id")
      .eq("is_active", true)
      .not("user_id", "is", null)
      .returns<PartyRow[]>(),
    // R68: the project's own active parties, for the (optional) "responsible party" picker — same
    // project_parties table/is_active scoping as the assignee list above, just the party row
    // itself rather than the login it's linked to.
    supabase
      .from("project_parties")
      .select("id, project_id, name, party_type")
      .eq("is_active", true)
      .order("name")
      .returns<ResponsiblePartyRow[]>(),
  ]);

  const userById = new Map((users ?? []).map((u) => [u.id, u]));
  const peopleByProject: Record<string, { id: string; name: string }[]> = {};
  for (const p of projects ?? []) peopleByProject[p.id] = [];

  const addPerson = (projectId: string, userId: string) => {
    const list = peopleByProject[projectId];
    const user = userById.get(userId);
    if (!list || !user) return;
    if (list.some((existing) => existing.id === userId)) return;
    list.push({ id: user.id, name: user.full_name || user.email });
  };

  for (const grant of grants ?? []) {
    if (grant.scope_type === "global") {
      for (const p of projects ?? []) addPerson(p.id, grant.user_id);
    } else if (grant.scope_type === "organization" && grant.organization_id) {
      for (const p of projects ?? []) {
        if (p.organization_id === grant.organization_id) addPerson(p.id, grant.user_id);
      }
    } else if (grant.scope_type === "project" && grant.project_id) {
      addPerson(grant.project_id, grant.user_id);
    }
  }
  for (const party of parties ?? []) {
    if (party.user_id) addPerson(party.project_id, party.user_id);
  }
  for (const list of Object.values(peopleByProject)) list.sort((a, b) => a.name.localeCompare(b.name));

  const partiesByProject: Record<string, { id: string; name: string; party_type: string }[]> = {};
  for (const p of projects ?? []) partiesByProject[p.id] = [];
  for (const party of responsibleParties ?? []) {
    const list = partiesByProject[party.project_id];
    if (list) list.push({ id: party.id, name: party.name, party_type: party.party_type });
  }

  return (
    <div className="max-w-xl">
      <Link href="/inspect/ncrs" className="text-sm text-burgundy hover:underline">
        ← Back to NCR Register
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Raise NCR / Observation</h1>
      <p className="mt-1 text-sm text-muted">
        Record a non-conformance or observation against a project — from a failed inspection, a
        walkdown, or standalone.
      </p>
      {params.inspection_record_id && (
        <p className="mt-2 rounded-md border border-border bg-off-white px-3 py-2 text-xs text-muted">
          Linked to inspection record — closing this NCR will notify the original inspector that
          the activity is ready for re-inspection.
        </p>
      )}
      <NewNcrForm
        projects={projects ?? []}
        peopleByProject={peopleByProject}
        partiesByProject={partiesByProject}
        initialProjectId={params.project_id}
        itpItemId={params.itp_item_id}
        inspectionRecordId={params.inspection_record_id}
        initialDescription={params.description}
      />
    </div>
  );
}
