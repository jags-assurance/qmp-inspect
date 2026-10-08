import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import Link from "next/link";
import { T } from "@/components/domain/t";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { ProjectsTable, type ProjectRow } from "./projects-table";
import { isClosedStatus } from "@/lib/projects/close-helpers";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { PageGuide } from "@/components/domain/page-guide";
import { OrgFilter } from "./org-filter";
import { orgFilterOptionsFrom } from "@/lib/projects/open-counts";
import { getTranslator } from "@/lib/i18n/server";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; show?: string }>;
}) {
  const tl = await getTranslator();
  const session = await requireSession();
  const { org: selectedOrgId, show } = await searchParams;
  const showClosed = show === "all" || show === "closed";
  const onlyClosed = show === "closed";
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

  const buildProjectsQuery = (columns: string) => {
    let q = supabase.from("projects").select(columns).order("created_at", { ascending: false });
    if (selectedOrgId) q = q.eq("organization_id", selectedOrgId);
    return q;
  };
  const withClosedAt = "id, project_number, name, site_location, status, end_date, closed_at, organization_id, organizations(name)";
  const firstTry = await buildProjectsQuery(withClosedAt).returns<ProjectRow[]>();
  const projectsError = firstTry.error;
  let allVisible = firstTry.data;
  if (projectsError && isMissingSchemaError(projectsError)) {
    // closed_at (20261104000600) not applied yet: list the projects without the closed date.
    ({ data: allVisible } = await buildProjectsQuery(withClosedAt.replace(" closed_at,", "")).returns<ProjectRow[]>());
  }
  // Completed / cancelled projects are hidden by default so the list shows live work first.
  const isClosed = isClosedStatus;
  const closedCount = (allVisible ?? []).filter((p) => isClosed(p.status)).length;
  const projects = onlyClosed
    ? (allVisible ?? []).filter((p) => isClosed(p.status))
    : showClosed
      ? allVisible
      : (allVisible ?? []).filter((p) => !isClosed(p.status));

  // Organisations for the filter dropdown — drawn from the same RLS-scoped `projects` query (not a
  // separate `organizations` select) so the list only ever shows orgs this session can actually see
  // projects for, and stays correct even while `selectedOrgId` narrows the `projects` fetch above.
  // With no organisation selected, `allVisible` already holds every visible project and its organisation
  // name, so the dropdown is built from it; a second identical-scope projects query only runs while an
  // organisation filter is narrowing `allVisible`.
  const allProjectOrgs = selectedOrgId
    ? (
        await supabase
          .from("projects")
          .select("organization_id, organizations(name)")
          .returns<{ organization_id: string; organizations: { name: string } | null }[]>()
      ).data
    : allVisible;
  const orgFilterOptions = orgFilterOptionsFrom(allProjectOrgs ?? []);

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
            <h1 className="text-2xl font-semibold text-ink"><T>Projects</T></h1>
            <PageGuide
              title={tl("Projects — how this works")}
              points={[
                "Every project you have access to, across every client — JAGS staff see everything they're granted; a client/contractor login sees only projects their organisation is engaged on.",
                "\"+ New project\" is normally Admin-only; it also appears for anyone whose organisation is on the Self-Managed (Hybrid) or Full Client-Managed engagement tier, since both run their own program and create their own projects.",
                "ITP completion % and open NCR count per row are computed live from that project's own ITPs and NCRs, not cached.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            <T>{session.isJagsStaff
              ? "Every project across every client you have access to."
              : "Projects your organisation is engaged on."}</T>
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto">
          {orgFilterOptions.length > 0 && <OrgFilter organizations={orgFilterOptions} />}
          {canCreateProject && (
            <Link href="/inspect/projects/new">
              <Button><T>+ New project</T></Button>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-6">
        {closedCount > 0 && (
          <p className="mb-3 text-sm text-muted">
            {onlyClosed
              ? "Showing closed (completed and cancelled) projects only."
              : showClosed
                ? "Showing all projects, including completed and cancelled."
                : `${closedCount} closed (completed or cancelled) project${closedCount > 1 ? "s are" : " is"} hidden.`}{" "}
            {(
              [
                { key: "", label: "Open only", active: !showClosed },
                { key: "closed", label: "Closed", active: onlyClosed },
                { key: "all", label: "All", active: show === "all" },
              ] as const
            ).map((opt, i) => (
              <span key={opt.label}>
                {i > 0 && " · "}
                {opt.active ? (
                  <span className="font-medium text-ink"><T>{opt.label}</T></span>
                ) : (
                  <Link
                    className="text-burgundy hover:underline"
                    href={`/inspect/projects?${new URLSearchParams({
                      ...(selectedOrgId ? { org: selectedOrgId } : {}),
                      ...(opt.key ? { show: opt.key } : {}),
                    }).toString()}`}
                  >
                    <T>{opt.label}</T>
                  </Link>
                )}
              </span>
            ))}
          </p>
        )}
        <ProjectsTable rows={projectRows} canCreate={canCreateProject} />
      </div>
    </div>
  );
}
