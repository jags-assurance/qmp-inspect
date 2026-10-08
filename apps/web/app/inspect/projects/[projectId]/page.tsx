import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { ProjectStatusControl } from "./project-status-control";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { ProjectOverviewView } from "./project-overview-view";
import { PunchListView, PUNCH_CLOSED_LIMITS } from "./punch-list/punch-list-view";
import { parseListLimit } from "@/lib/pagination/list-limit";
import { RegistersView, REGISTER_LIMITS } from "./registers/registers-view";
import { ActivityView } from "./activity/activity-view";
import { KpisView } from "./kpis/kpis-view";
import { DataBookView } from "./data-book/data-book-view";
import { ReportsView } from "./reports/reports-view";
import { GuideView } from "./guide/guide-view";
import { AuditLogView } from "./audit-log/audit-log-view";
import { ItpsTabView, NcrsTabView } from "./workspace/project-record-lists";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { countOpenNcrs, countPunchByStatus } from "@/lib/projects/open-counts";
import { WorkspaceSkeleton, WorkspaceTabs, type WorkspaceTab, type WorkspaceTabKey } from "./workspace/workspace-tabs";
import { T } from "@/components/domain/t";

const STATUS_TONE: Record<string, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  draft: "neutral",
  on_hold: "warning",
  completed: "neutral",
  cancelled: "danger",
};

/**
 * The project workspace: ONE window for everything scoped to a project. The header and tab bar
 * stay put; the tab picks which section fills the pane below (`?tab=`), so punch list, NCRs,
 * observations, ITPs, registers, activity, KPIs, data book, reports and the guide are all a tab
 * away instead of nine separate pages to navigate between. Each pane is the same view its own
 * route renders (those routes still work), embedded with its heading demoted and its back-link
 * removed. Only the chosen tab's data is fetched.
 */
export default async function ProjectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string; range?: string; limit?: string }>;
}) {
  const { projectId } = await params;
  const { tab: tabParam, range, limit: limitParam } = await searchParams;
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // The tab badges need open NCRs, open observations and outstanding punch items. That is TWO light
  // row queries (ncrs.severity, punch.status — open rows only) instead of three head counts, and the
  // numbers are handed to the overview so it does not count the same rows again.
  const [{ data: project }, openNcrRows, openPunchRows] = await Promise.all([
    supabase
      .from("projects")
      .select("id, project_number, name, status, site_location, country, organizations(name)")
      .eq("id", projectId)
      .maybeSingle<{
        id: string;
        project_number: string;
        name: string;
        status: string;
        site_location: string | null;
        country: string | null;
        organizations: { name: string } | null;
      }>(),
    fetchAll<{ id: string; severity: string }>((from, to) =>
      supabase
        .from("ncrs" as never)
        .select("id, severity")
        .eq("project_id", projectId)
        .neq("status", "closed")
        .order("id")
        .range(from, to)
        .returns<{ id: string; severity: string }[]>()
    ),
    fetchAll<{ id: string; status: string }>((from, to) =>
      supabase
        .from(PUNCH_LIST_ITEMS_TABLE)
        .select("id, status")
        .eq("project_id", projectId)
        .neq("status", "closed")
        .order("id")
        .range(from, to)
        .returns<{ id: string; status: string }[]>()
    ),
  ]);
  const ncrCounts = countOpenNcrs(openNcrRows);
  const punchCounts = countPunchByStatus(openPunchRows);
  const openNcrs = ncrCounts.ncrs;
  const openObservations = ncrCounts.observations;
  const openPunch = punchCounts.outstanding;
  if (!project) notFound();

  const tabs: WorkspaceTab[] = [
    { key: "overview", label: "Overview", short: "Overview" },
    { key: "punch-list", label: "Punch list", short: "Punch", count: openPunch },
    { key: "ncrs", label: "NCRs", count: openNcrs },
    { key: "observations", label: "Observations", short: "Obs.", count: openObservations },
    { key: "itps", label: "ITPs" },
    { key: "registers", label: "Registers" },
    { key: "activity", label: "Activity" },
    { key: "kpis", label: "KPIs" },
    { key: "data-book", label: "Data book", short: "Data" },
    { key: "reports", label: "Reports" },
    { key: "guide", label: "Guide" },
    ...(session.isJagsStaff ? [{ key: "audit-log" as const, label: "Audit log", short: "Audit" }] : []),
  ];
  const active: WorkspaceTabKey = tabs.some((t) => t.key === tabParam) ? (tabParam as WorkspaceTabKey) : "overview";
  const tabBar = <WorkspaceTabs projectId={projectId} tabs={tabs} active={active} />;

  const backLink = (
    <Link href="/inspect/projects" className="inline-flex min-h-9 items-center text-sm text-burgundy hover:underline">
      <T>← Back to Projects</T>
    </Link>
  );

  if (active === "overview") {
    return (
      <div>
        {backLink}
        <ProjectOverviewView
          projectId={projectId}
          tabBar={tabBar}
          knownCounts={{ openNcrsAndObservations: ncrCounts.total, openObservations: ncrCounts.observations, openPunchOutstanding: punchCounts.outstanding, openPunchOpen: punchCounts.open }}
        />
      </div>
    );
  }

  return (
    <div>
      {backLink}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="doc-id text-sm text-muted">{project.project_number}</p>
          <h1 className="text-xl font-semibold text-ink sm:text-2xl [overflow-wrap:anywhere]">{project.name}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {project.organizations?.name ?? "—"}
            {project.site_location && ` · ${project.site_location}`}
            {project.country && `, ${project.country}`}
          </p>
        </div>
        {isAdminStaff(session) ? (
          <ProjectStatusControl projectId={project.id} status={project.status} />
        ) : (
          <Badge tone={STATUS_TONE[project.status] ?? "neutral"}>{project.status.replace("_", " ")}</Badge>
        )}
      </div>

      {tabBar}

      <Suspense key={`${active}:${range ?? ""}:${limitParam ?? ""}`} fallback={<WorkspaceSkeleton />}>
        <div className="pt-4">
          {active === "punch-list" && <PunchListView projectId={projectId} embedded closedLimit={parseListLimit(limitParam, PUNCH_CLOSED_LIMITS)} searchParams={{ tab: "punch-list", range, limit: limitParam }} />}
          {active === "ncrs" && <NcrsTabView projectId={projectId} />}
          {active === "observations" && <NcrsTabView projectId={projectId} observations />}
          {active === "itps" && <ItpsTabView projectId={projectId} />}
          {active === "registers" && <RegistersView projectId={projectId} embedded limit={parseListLimit(limitParam, REGISTER_LIMITS)} searchParams={{ tab: "registers", range, limit: limitParam }} />}
          {active === "activity" && <ActivityView projectId={projectId} range={range} embedded />}
          {active === "kpis" && <KpisView projectId={projectId} embedded />}
          {active === "data-book" && <DataBookView projectId={projectId} embedded />}
          {active === "reports" && <ReportsView projectId={projectId} embedded />}
          {active === "guide" && <GuideView projectId={projectId} embedded />}
          {active === "audit-log" && session.isJagsStaff && <AuditLogView projectId={projectId} range={range} embedded />}
        </div>
      </Suspense>
    </div>
  );
}
