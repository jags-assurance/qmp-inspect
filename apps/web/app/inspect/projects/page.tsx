import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { ProjectsTable, type ProjectRow } from "./projects-table";

export default async function ProjectsPage() {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name, site_location, status, organizations(name)")
    .order("created_at", { ascending: false })
    .returns<ProjectRow[]>();

  const projectIds = (projects ?? []).map((p) => p.id);

  // ITP completion % (client_accepted / total per project) and open NCR count per project — fetched
  // as two flat queries scoped to the visible project set (RLS still applies) and reduced client-side
  // into per-project maps, rather than one round-trip per row. Fine at this app's current scale (a
  // handful of projects per admin), matches the aggregation style already used on the dashboard
  // (apps/web/app/inspect/page.tsx's orgPortfolio open-NCR counts) and in computeProjectKpis().
  let itpCompletionByProject = new Map<string, { clientAccepted: number; total: number }>();
  let openNcrsByProject = new Map<string, number>();
  if (projectIds.length > 0) {
    const [{ data: itpRows }, { data: ncrRows }] = await Promise.all([
      supabase.from("itps").select("project_id, status").in("project_id", projectIds).returns<{ project_id: string; status: string }[]>(),
      supabase
        .from(NCRS_TABLE)
        .select("project_id, status")
        .in("project_id", projectIds)
        .neq("status", "closed")
        .returns<{ project_id: string; status: string }[]>(),
    ]);

    itpCompletionByProject = new Map();
    for (const row of itpRows ?? []) {
      const entry = itpCompletionByProject.get(row.project_id) ?? { clientAccepted: 0, total: 0 };
      entry.total += 1;
      if (row.status === "client_accepted") entry.clientAccepted += 1;
      itpCompletionByProject.set(row.project_id, entry);
    }

    openNcrsByProject = new Map();
    for (const row of ncrRows ?? []) {
      openNcrsByProject.set(row.project_id, (openNcrsByProject.get(row.project_id) ?? 0) + 1);
    }
  }

  const projectRows: ProjectRow[] = (projects ?? []).map((p) => ({
    ...p,
    itpCompletionPct: (() => {
      const counts = itpCompletionByProject.get(p.id);
      if (!counts || counts.total === 0) return null;
      return Math.round((counts.clientAccepted / counts.total) * 100);
    })(),
    openNcrCount: openNcrsByProject.get(p.id) ?? 0,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Every project across every client you have access to."
              : "Projects your organisation is engaged on."}
          </p>
        </div>
        {isAdminStaff(session) && (
          <Link href="/inspect/projects/new">
            <Button>+ New project</Button>
          </Link>
        )}
      </div>

      <div className="mt-6">
        <ProjectsTable rows={projectRows} />
      </div>
    </div>
  );
}
