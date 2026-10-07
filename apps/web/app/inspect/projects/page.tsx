import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { ProjectsTable, type ProjectRow } from "./projects-table";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { PageGuide } from "@/components/domain/page-guide";
import { OrgFilter } from "./org-filter";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; show?: string }>;
}) {
  const session = await requireSession();
  const { org: selectedOrgId, show } = await searchParams;
  const showClosed = show === "all";
  const supabase = await createSupabaseServerClient();

  // Project creation is normally Admin-only, but a Self-Managed/Platform-Only client runs its own
  // program on the platform (supabase/migrations/20260919010000_self_managed_project_creation.sql)
  // — mirrors that RLS policy's own check so the button never appears somewhere the create page
  // would then redirect away from.
  let canCreateProject = isAdminStaff(session);
  if (!canCreateProject && !session.isJagsStaff) {
    const { data: grants } = await supabase
      .from("access_grants")
      .select("organizations(engagement_scope)")
      .eq("user_id", session.userId)
      .returns<{ organizations: { engagement_scope: string } | null }[]>();
    canCreateProject = (grants ?? []).some(
      (g) => g.organizations?.engagement_scope === "self_managed" || g.organizations?.engagement_scope === "client_managed"
    );
  }

  let projectsQuery = supabase
    .from("projects")
    .select("id, project_number, name, site_location, status, end_date, organization_id, organizations(name)")
    .order("created_at", { ascending: false });
  if (selectedOrgId) projectsQuery = projectsQuery.eq("organization_id", selectedOrgId);
  const { data: allVisible } = await projectsQuery.returns<ProjectRow[]>();
  // Completed / cancelled projects are hidden by default so the list shows live work first.
  const isClosed = (s: string) => s === "completed" || s === "cancelled";
  const closedCount = (allVisible ?? []).filter((p) => isClosed(p.status)).length;
  const projects = showClosed ? allVisible : (allVisible ?? []).filter((p) => !isClosed(p.status));

  // Organisations for the filter dropdown — drawn from the same RLS-scoped `projects` query (not a
  // separate `organizations` select) so the list only ever shows orgs this session can actually see
  // projects for, and stays correct even while `selectedOrgId` narrows the `projects` fetch above.
  const { data: allProjectOrgs } = await supabase
    .from("projects")
    .select("organization_id, organizations(name)")
    .returns<{ organization_id: string; organizations: { name: string } | null }[]>();
  const orgFilterOptions = [
    ...new Map(
      (allProjectOrgs ?? [])
        .filter((p) => p.organizations)
        .map((p) => [p.organization_id, { id: p.organization_id, label: p.organizations!.name }])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));

  const projectIds = (projects ?? []).map((p) => p.id);

  // ITP completion % (client_accepted / total per project) and open NCR count per project — fetched
  // as two flat queries scoped to the visible project set (RLS still applies) and reduced client-side
  // into per-project maps, rather than one round-trip per row. Fine at this app's current scale (a
  // handful of projects per admin), matches the aggregation style already used on the dashboard
  // (apps/web/app/inspect/page.tsx's orgPortfolio open-NCR counts) and in computeProjectKpis().
  let itpCompletionByProject = new Map<string, { clientAccepted: number; total: number }>();
  let openNcrsByProject = new Map<string, number>();
  const openPunchByProject = new Map<string, number>();
  if (projectIds.length > 0) {
    const [{ data: itpRows }, { data: ncrRows }, { data: punchRows }] = await Promise.all([
      supabase.from("itps").select("project_id, status").in("project_id", projectIds).returns<{ project_id: string; status: string }[]>(),
      supabase
        .from(NCRS_TABLE)
        .select("project_id, status")
        .in("project_id", projectIds)
        .neq("status", "closed")
        .returns<{ project_id: string; status: string }[]>(),
      supabase
        .from(PUNCH_LIST_ITEMS_TABLE)
        .select("project_id")
        .in("project_id", projectIds)
        .neq("status", "closed")
        .returns<{ project_id: string }[]>(),
    ]);
    for (const row of punchRows ?? []) {
      openPunchByProject.set(row.project_id, (openPunchByProject.get(row.project_id) ?? 0) + 1);
    }

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

  // Overdue hold points: the existing overdue_hold_points() RPC (one query, access-checked in SQL)
  // returns one row per overdue hold with a "number — name" project label; count them per project.
  // Not in the generated Database type yet — same documented escape hatch as admin-overdue-holds.tsx.
  const overdueByLabel = new Map<string, number>();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: overdueRows } = await (supabase.rpc as any)("overdue_hold_points");
    for (const row of (overdueRows ?? []) as { project_label: string }[]) {
      overdueByLabel.set(row.project_label, (overdueByLabel.get(row.project_label) ?? 0) + 1);
    }
  } catch {
    // Column shows 0 if the RPC is unavailable.
  }

  const projectRows: ProjectRow[] = (projects ?? []).map((p) => ({
    ...p,
    overdueHoldCount: overdueByLabel.get(`${p.project_number} — ${p.name}`) ?? 0,
    itpCompletionPct: (() => {
      const counts = itpCompletionByProject.get(p.id);
      if (!counts || counts.total === 0) return null;
      return Math.round((counts.clientAccepted / counts.total) * 100);
    })(),
    openNcrCount: openNcrsByProject.get(p.id) ?? 0,
    openPunchCount: openPunchByProject.get(p.id) ?? 0,
  }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">Projects</h1>
            <PageGuide
              title="Projects — how this works"
              points={[
                "Every project you have access to, across every client — JAGS staff see everything they're granted; a client/contractor login sees only projects their organisation is engaged on.",
                "\"+ New project\" is normally Admin-only; it also appears for anyone whose organisation is on the Self-Managed (Hybrid) or Full Client-Managed engagement tier, since both run their own program and create their own projects.",
                "ITP completion % and open NCR count per row are computed live from that project's own ITPs and NCRs, not cached.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            {session.isJagsStaff
              ? "Every project across every client you have access to."
              : "Projects your organisation is engaged on."}
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto">
          {orgFilterOptions.length > 0 && <OrgFilter organizations={orgFilterOptions} />}
          {canCreateProject && (
            <Link href="/inspect/projects/new">
              <Button>+ New project</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6">
        {closedCount > 0 && (
          <p className="mb-3 text-sm text-muted">
            {showClosed
              ? "Showing all projects, including completed and cancelled."
              : `${closedCount} completed or cancelled project${closedCount > 1 ? "s are" : " is"} hidden.`}{" "}
            <Link
              className="text-burgundy hover:underline"
              href={`/inspect/projects?${new URLSearchParams({
                ...(selectedOrgId ? { org: selectedOrgId } : {}),
                ...(showClosed ? {} : { show: "all" }),
              }).toString()}`}
            >
              {showClosed ? "Hide closed" : "Show closed"}
            </Link>
          </p>
        )}
        <ProjectsTable rows={projectRows} canCreate={canCreateProject} />
      </div>
    </div>
  );
}
