import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { hasPermission } from "@/lib/rbac/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NewAssignmentForm } from "./new-assignment-form";
import { getActiveMasterDisciplines } from "@/lib/master-disciplines/cache";
import { getLocationPresetsForProject } from "@/lib/checklists/location-presets";
import { PageGuide } from "@/components/domain/page-guide";
import { T } from "@/components/domain/t";
import { getTranslator } from "@/lib/i18n/server";

export default async function NewStandaloneAssignmentPage() {
  const tl = await getTranslator();
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Booking/running a standalone FAT/witness/test assignment is JAGS staff's job by default, same
  // boundary as ITP creation (apps/web/app/inspect/itps/new/page.tsx) — unless this person holds
  // the run_standalone_assignment custom permission (Full Client-Managed tier only), OR is an
  // active subcontractor/main_contractor on at least one project that's opted into
  // allow_contractor_standalone_assignment (tier-independent — see canRunStandaloneAssignment,
  // lib/standalone/actions.ts, for the exact 3-way rule this mirrors).
  const orgWidePermission = await hasPermission(session.userId, "run_standalone_assignment");

  let projects: { id: string; project_number: string; name: string }[] = [];
  if (session.isJagsStaff || orgWidePermission) {
    // RLS already scopes this to projects has_org_access() actually reaches.
    const { data } = await supabase.from("projects").select("id, project_number, name").order("name");
    projects = data ?? [];
  } else {
    const { data: eligibleParties } = await supabase
      .from("project_parties")
      .select("projects(id, project_number, name, allow_contractor_standalone_assignment)")
      .eq("user_id", session.userId)
      .eq("is_active", true)
      .in("party_type", ["subcontractor", "main_contractor"])
      .returns<{ projects: { id: string; project_number: string; name: string; allow_contractor_standalone_assignment: boolean } | null }[]>();
    projects = (eligibleParties ?? [])
      .map((p) => p.projects)
      .filter((p): p is NonNullable<typeof p> => !!p?.allow_contractor_standalone_assignment)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  if (!session.isJagsStaff && !orgWidePermission && projects.length === 0) {
    redirect("/inspect/standalone");
  }

  const disciplines = await getActiveMasterDisciplines();

  const presetsByProject: Record<string, string[]> = {};
  if (projects.length > 0) {
    const { data: orgRows } = await supabase
      .from("projects")
      .select("id, organization_id")
      .in("id", projects.map((p) => p.id))
      .returns<{ id: string; organization_id: string }[]>();
    await Promise.all(
      (orgRows ?? []).map(async (p) => {
        presetsByProject[p.id] = (await getLocationPresetsForProject(supabase, p.organization_id, p.id)).map((r) => r.name);
      })
    );
  }

  return (
    <div className="max-w-2xl">
      <Link href="/inspect/standalone" className="text-sm text-burgundy hover:underline">
        <T>← Back to Assignments</T>
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-ink"><T>New assignment</T></h1>
        <PageGuide
          title={tl("New assignment — how this works")}
          points={[
            "Only JAGS staff can reach this page by default — booking/running a standalone FAT, witness inspection, specific test or pre-shipment check is JAGS staff's job, same boundary as ITP creation — unless your organisation is Full Client-Managed and you hold the run_standalone_assignment custom permission, or you're an active subcontractor/main-contractor party on a project that's specifically opted into contractor-run assignments.",
            "The project list above only shows projects you're actually eligible to create one on — for a subcontractor/main-contractor login, that's just the projects with contractor-run assignments turned on.",
            "The assignment number is generated automatically on save, with a type-specific prefix (FAT/WI/ST/PS) — never hand-entered.",
            "This only creates the assignment shell; measurements, photos, punch items and signatures are then added from the assignment's own detail page, gated the same way as this page.",
          ]}
        />
      </div>
      <p className="mt-1 text-sm text-muted">
        <T>Set up a one-off assignment. The number is created when you save.</T>
      </p>
      <NewAssignmentForm projects={projects ?? []} disciplines={disciplines ?? []} presetsByProject={presetsByProject} />
    </div>
  );
}
