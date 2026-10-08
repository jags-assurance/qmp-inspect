import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE } from "@/lib/signoff/db-types";
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { NCRS_TABLE, type NcrSeverity } from "@/lib/ncrs/types";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { getLatestPortfolioSummaryPdf } from "@/lib/reports/actions";
import { PortfolioSummaryPdfButton } from "./portfolio-summary-pdf-button";
import { PageGuide } from "@/components/domain/page-guide";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

/**
 * A lightweight in-app equivalent of the vw_powerbi_* views (see
 * apps/web/app/inspect/organisation/reporting/page.tsx), computed from the same base tables instead
 * of reusing those views directly. That's a deliberate, security-driven choice, not a style
 * preference: the vw_powerbi_* views were built for the standalone powerbi_reader Postgres login and
 * carry NO row-level filtering by design (see 20260910120000_phase3_powerbi_reporting_views.sql's own
 * header comment — "deliberately an all clients all projects rollup"). A plain Postgres view runs
 * with security_invoker=false by default, so it evaluates the underlying tables' RLS as the view
 * OWNER rather than the querying role — granting the ordinary `authenticated` role SELECT on them
 * (which an earlier draft of this page did) would have let ANY logged-in user, including a client or
 * subcontractor, read every organisation's aggregate data directly via the Supabase client, bypassing
 * both this page's isAdminStaff gate and every RLS policy in the database. See
 * 20260916140000_grant_powerbi_views_to_authenticated.sql for the fix (a REVOKE, restoring the views
 * to powerbi_reader-only) and its full writeup. Querying projects/itps/itp_items/inspection_records/
 * ncrs/activity_signoff_progress directly here means these numbers go through the same has_org_access
 * RLS every other page in this app already relies on — for a global JAGS admin (the only role that
 * reaches this page) that resolves to "every project," same end result as the views, without ever
 * widening what a non-admin session could reach.
 */

interface ItpRow {
  id: string;
  project_id: string;
  status: "draft" | "under_review" | "approved" | "client_accepted";
}

interface ItpSectionRow {
  id: string;
  itp_id: string;
}

interface ItpItemRow {
  id: string;
  section_id: string;
  evidence_type: 1 | 2 | 3;
}

interface InspectionRecordRow {
  id: string;
  project_id: string;
  itp_item_id: string;
  overall_result: "pass" | "fail" | "partial" | null;
  created_at: string;
}

interface SignoffRow {
  itp_item_id: string;
  notified_at: string | null;
  signed_off_at: string | null;
}

interface NcrRow {
  id: string;
  project_id: string;
  status: string;
  severity: NcrSeverity;
  created_at: string;
  closed_at: string | null;
}

interface PunchListItemRow {
  id: string;
  project_id: string;
  status: string;
  due_date: string | null;
}

type HealthTone = "success" | "warning" | "danger";
const HEALTH_LABEL: Record<HealthTone, string> = { success: "On track", warning: "At risk", danger: "Critical" };

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60);
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

/** Below this many underlying data points, a computed average/rate isn't very meaningful — surface
 * the sample size alongside the stat so a viewer can judge confidence themselves instead of reading a
 * decimal-precision figure as a real measurement. */
const SMALL_SAMPLE_THRESHOLD = 5;

function sampleCaption(sampleSize: number): string | undefined {
  return sampleSize > 0 && sampleSize < SMALL_SAMPLE_THRESHOLD ? `Based on ${sampleSize} data point${sampleSize === 1 ? "" : "s"}` : undefined;
}

const PORTFOLIO_INSIGHTS_GUIDE_POINTS = [
  "Admin-only — a live, in-app rollup across every client and project, computed from the same base tables Power BI reads (see Reporting) but through the ordinary RLS-scoped queries every other page uses, not the unscoped vw_powerbi_* views (those are for the standalone powerbi_reader login only).",
  "\"Blocking\" levels used for hold-point turnaround are approximated across every organisation's own custom intervention levels, not one org's — there's no single org to scope to on a portfolio-wide page.",
  "A stat shown with \"(n=...)\" or a small-sample caption is based on fewer than 5 underlying data points — read it as low-confidence, not a firm measurement.",
  "Project Health is a computed indicator, not a stored field: Critical means an open Major NCR or 3+ overdue punch items; At risk means any open NCR, any overdue punch item, or ITP completion under 50%; On track means none of that.",
  "The PDF button generates a point-in-time portfolio summary; the numbers on this page itself are always live on page load.",
];

export async function PortfolioInsightsView({ embedded }: { embedded?: boolean }) {
  const Heading = embedded ? "h2" : "h1";
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const latestPortfolioSummaryPdf = await getLatestPortfolioSummaryPdf();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .returns<{ id: string; project_number: string; name: string }[]>();
  const projectIds = (projects ?? []).map((p) => p.id);

  if (projectIds.length === 0) {
    return (
      <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Heading className="text-2xl font-semibold text-ink">Portfolio Insights</Heading>
            <PageGuide title="Portfolio Insights — how this works" points={PORTFOLIO_INSIGHTS_GUIDE_POINTS} />
          </div>
          <PortfolioSummaryPdfButton latest={latestPortfolioSummaryPdf} />
        </div>
        <p className="mt-3 text-sm text-muted">No projects yet.</p>
      </div>
    );
  }

  const [{ data: itps }, { data: ncrs }, { data: punchItems }] = await Promise.all([
    supabase.from("itps").select("id, project_id, status").in("project_id", projectIds).returns<ItpRow[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("id, project_id, status, severity, created_at, closed_at")
      .in("project_id", projectIds)
      .returns<NcrRow[]>(),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id, project_id, status, due_date")
      .in("project_id", projectIds)
      .returns<PunchListItemRow[]>(),
  ]);

  const itpIds = (itps ?? []).map((i) => i.id);
  const { data: sections } = itpIds.length
    ? await supabase.from("itp_sections").select("id, itp_id").in("itp_id", itpIds).returns<ItpSectionRow[]>()
    : { data: [] as ItpSectionRow[] };
  const sectionIds = (sections ?? []).map((s) => s.id);
  const sectionToItp = new Map((sections ?? []).map((s) => [s.id, s.itp_id]));
  const itpStatusById = new Map((itps ?? []).map((i) => [i.id, i.status]));

  const { data: items } = sectionIds.length
    ? await supabase.from("itp_items").select("id, section_id, evidence_type").in("section_id", sectionIds).returns<ItpItemRow[]>()
    : { data: [] as ItpItemRow[] };
  const itemIds = (items ?? []).map((i) => i.id);

  // Blocking-level codes (Hold-equivalent) across EVERY organisation — this page is a global,
  // all-clients rollup (see header comment above), so unlike the single-project KPI computation
  // (lib/kpis/compute.ts, which resolves one project's own organisation), there's no single org to
  // scope to here. Using every org's distinct blocking codes is a reasonable approximation: every
  // org still has the built-in "H" among them, and a custom blocking code from one org simply
  // widens the filter slightly rather than narrowing it incorrectly for another.
  const { data: blockingLevelTypes } = await supabase
    .from(INTERVENTION_LEVEL_TYPES_TABLE)
    .select("code")
    .eq("is_blocking", true)
    .returns<{ code: string }[]>();
  const blockingCodes = [...new Set((blockingLevelTypes ?? []).map((l) => l.code))];

  const [{ data: records }, { data: signoffs }] = await Promise.all([
    itemIds.length
      ? supabase
          .from("inspection_records")
          .select("id, project_id, itp_item_id, overall_result, created_at")
          .in("project_id", projectIds)
          .order("created_at", { ascending: true })
          .returns<InspectionRecordRow[]>()
      : Promise.resolve({ data: [] as InspectionRecordRow[] }),
    itemIds.length && blockingCodes.length
      ? supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("itp_item_id, notified_at, signed_off_at")
          .in("intervention", blockingCodes)
          .in("itp_item_id", itemIds)
          .returns<SignoffRow[]>()
      : Promise.resolve({ data: [] as SignoffRow[] }),
  ]);

  // --- Inspections completed vs planned (portfolio-wide) ---
  const totalCompleted = (records ?? []).filter((r) => r.overall_result !== null).length;
  const totalPlanned = (items ?? []).filter((item) => {
    const parentItpId = sectionToItp.get(item.section_id);
    const status = parentItpId ? itpStatusById.get(parentItpId) : null;
    return item.evidence_type === 1 && (status === "approved" || status === "client_accepted");
  }).length;

  // --- ITP completion %, per project then averaged (matches vw_powerbi_itp_completion's per-project rows) ---
  const itpCountsByProject = new Map<string, { total: number; clientAccepted: number }>();
  for (const itp of itps ?? []) {
    const entry = itpCountsByProject.get(itp.project_id) ?? { total: 0, clientAccepted: 0 };
    entry.total += 1;
    if (itp.status === "client_accepted") entry.clientAccepted += 1;
    itpCountsByProject.set(itp.project_id, entry);
  }
  const itpCompletionByProject = [...itpCountsByProject.entries()].map(([projectId, counts]) => ({
    projectId,
    pct: counts.total > 0 ? Math.round((counts.clientAccepted / counts.total) * 1000) / 10 : null,
    total: counts.total,
  }));
  const itpRatesWithData = itpCompletionByProject.filter((r) => r.pct !== null);
  const avgItpCompletion = itpRatesWithData.length
    ? itpRatesWithData.reduce((sum, r) => sum + (r.pct ?? 0), 0) / itpRatesWithData.length
    : null;

  // --- First-time pass rate (earliest inspection_record per itp_item, portfolio-wide) ---
  const firstAttemptByItem = new Map<string, InspectionRecordRow>();
  for (const record of records ?? []) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }
  const firstAttempts = [...firstAttemptByItem.values()].filter((r) => r.overall_result !== null);
  const firstTimePasses = firstAttempts.filter((r) => r.overall_result === "pass");
  const avgFirstTimePassRate = firstAttempts.length > 0 ? (firstTimePasses.length / firstAttempts.length) * 100 : null;

  // --- Hold-point turnaround (signed-off H-intervention rows, portfolio-wide) ---
  const holdDurations = (signoffs ?? [])
    .filter((s) => s.notified_at && s.signed_off_at)
    .map((s) => hoursBetween(s.notified_at as string, s.signed_off_at as string));
  const avgHoldPointHours = average(holdDurations);

  // --- NCR volume, last 6 calendar months, broken down by severity ---
  const monthSeverityTotals = new Map<string, Record<NcrSeverity, number>>();
  for (const ncr of ncrs ?? []) {
    const key = ncr.created_at.slice(0, 7); // "YYYY-MM"
    const entry = monthSeverityTotals.get(key) ?? { observation: 0, minor_ncr: 0, major_ncr: 0 };
    entry[ncr.severity] += 1;
    monthSeverityTotals.set(key, entry);
  }
  const last6Months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const ncrByMonth = last6Months.map((key) => {
    const entry = monthSeverityTotals.get(key) ?? { observation: 0, minor_ncr: 0, major_ncr: 0 };
    return {
      key,
      major: entry.major_ncr,
      minor: entry.minor_ncr,
      observation: entry.observation,
      count: entry.major_ncr + entry.minor_ncr + entry.observation,
    };
  });
  const maxMonthCount = Math.max(1, ...ncrByMonth.map((m) => m.count));

  // --- NCR severity/status breakdown (portfolio-wide, open == not closed) ---
  const openNcrs = (ncrs ?? []).filter((n) => n.status !== "closed");
  const openNcrsBySeverity = new Map<NcrSeverity, number>();
  for (const ncr of openNcrs) {
    openNcrsBySeverity.set(ncr.severity, (openNcrsBySeverity.get(ncr.severity) ?? 0) + 1);
  }

  // --- Avg NCR closure time (created_at -> closed_at, for NCRs that have actually closed) ---
  const closureDurations = (ncrs ?? [])
    .filter((n) => n.status === "closed" && n.closed_at)
    .map((n) => hoursBetween(n.created_at, n.closed_at as string));
  const avgClosureHours = average(closureDurations);
  const avgClosureLabel =
    avgClosureHours !== null
      ? avgClosureHours >= 48
        ? `${(avgClosureHours / 24).toFixed(1)}d`
        : `${avgClosureHours.toFixed(1)}h`
      : "—";

  // --- Overdue punch items (open/resolved, past due_date) ---
  const todayIso = new Date().toISOString().slice(0, 10);
  const overduePunchItems = (punchItems ?? []).filter(
    (p) => p.status !== "closed" && p.due_date !== null && p.due_date < todayIso
  );

  // --- Per-project rollups feeding the Project Health table ---
  const openNcrsByProject = new Map<string, number>();
  const majorOpenNcrsByProject = new Map<string, number>();
  for (const ncr of openNcrs) {
    openNcrsByProject.set(ncr.project_id, (openNcrsByProject.get(ncr.project_id) ?? 0) + 1);
    if (ncr.severity === "major_ncr") {
      majorOpenNcrsByProject.set(ncr.project_id, (majorOpenNcrsByProject.get(ncr.project_id) ?? 0) + 1);
    }
  }
  const overduePunchByProject = new Map<string, number>();
  for (const item of overduePunchItems) {
    overduePunchByProject.set(item.project_id, (overduePunchByProject.get(item.project_id) ?? 0) + 1);
  }

  // --- Per-project ITP completion + health, sorted worst-first ---
  const itpByProjectSorted = (projects ?? [])
    .map((project) => {
      const itpRow = itpCompletionByProject.find((r) => r.projectId === project.id);
      const pct = itpRow?.pct ?? null;
      const total = itpRow?.total ?? 0;
      const openNcrCount = openNcrsByProject.get(project.id) ?? 0;
      const majorOpenNcrCount = majorOpenNcrsByProject.get(project.id) ?? 0;
      const overdueCount = overduePunchByProject.get(project.id) ?? 0;
      const health: HealthTone =
        majorOpenNcrCount > 0 || overdueCount >= 3
          ? "danger"
          : openNcrCount > 0 || overdueCount > 0 || (pct !== null && pct < 50)
            ? "warning"
            : "success";
      return { projectId: project.id, project, pct, total, openNcrCount, overdueCount, health };
    })
    .sort((a, b) => {
      const rank: Record<HealthTone, number> = { danger: 0, warning: 1, success: 2 };
      if (rank[a.health] !== rank[b.health]) return rank[a.health] - rank[b.health];
      return (a.pct ?? 0) - (b.pct ?? 0);
    });

  const healthColumns: ResponsiveColumn<(typeof itpByProjectSorted)[number]>[] = [
    {
      key: "project",
      header: "Project",
      className: "pr-3",
      cardLabel: null,
      render: (r) => (
        <Link href={`/inspect/projects/${r.projectId}`} className="text-burgundy hover:underline">
          <span className="doc-id">{r.project?.project_number}</span> — {r.project?.name}
        </Link>
      ),
    },
    {
      key: "itp",
      header: "ITP completion",
      className: "pr-3 tabular-nums text-ink",
      render: (r) =>
        r.pct !== null ? (
          <>
            {r.pct.toFixed(1)}%
            {r.total < SMALL_SAMPLE_THRESHOLD && <span className="ml-1 font-normal text-muted">(n={r.total})</span>}
          </>
        ) : (
          "—"
        ),
    },
    { key: "ncr", header: "Open NCRs", className: "pr-3 tabular-nums text-ink", render: (r) => r.openNcrCount },
    { key: "punch", header: "Overdue punch", className: "pr-3 tabular-nums text-ink", render: (r) => r.overdueCount },
    { key: "health", header: "Health", render: (r) => <Badge tone={r.health}>{HEALTH_LABEL[r.health]}</Badge> },
  ];

  return (
    <div className={embedded ? undefined : "max-w-4xl"}>
      <SettingsBackLink embedded={embedded} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Heading className="text-2xl font-semibold text-ink">Portfolio Insights</Heading>
            <PageGuide title="Portfolio Insights — how this works" points={PORTFOLIO_INSIGHTS_GUIDE_POINTS} />
          </div>
          <p className="mt-1 text-sm text-muted">
            A live, in-app summary across every client and project you have access to — the same
            aggregates Power BI Desktop reads (see{" "}
            <a href="/inspect/organisation/reporting" className="underline">
              Reporting
            </a>
            ), computed here through the ordinary RLS-scoped queries every other page in this app uses.
            Admin-only.
          </p>
        </div>
        <PortfolioSummaryPdfButton latest={latestPortfolioSummaryPdf} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Active projects" value={projectIds.length} />
        <StatCard
          label="Inspections completed"
          value={totalPlanned ? `${totalCompleted} / ${totalPlanned}` : totalCompleted}
        />
        <StatCard
          label="Avg ITP completion"
          value={avgItpCompletion !== null ? `${avgItpCompletion.toFixed(1)}%` : "—"}
          caption={avgItpCompletion !== null ? sampleCaption(itpRatesWithData.length) : "No ITP data yet"}
        />
        <StatCard
          label="Avg first-time pass rate"
          value={avgFirstTimePassRate !== null ? `${avgFirstTimePassRate.toFixed(1)}%` : "—"}
          caption={avgFirstTimePassRate !== null ? sampleCaption(firstAttempts.length) : "No inspection attempts yet"}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Avg hold-point turnaround"
          value={avgHoldPointHours !== null ? `${avgHoldPointHours.toFixed(1)}h` : "—"}
          caption={avgHoldPointHours !== null ? sampleCaption(holdDurations.length) : "No hold-point signoffs yet"}
        />
        <StatCard
          label="Open NCRs"
          value={openNcrs.length}
          href="/inspect/ncrs"
          caption={
            openNcrs.length > 0
              ? `${openNcrsBySeverity.get("major_ncr") ?? 0} major · ${openNcrsBySeverity.get("minor_ncr") ?? 0} minor · ${openNcrsBySeverity.get("observation") ?? 0} obs.`
              : "None open"
          }
        />
        <StatCard
          label="Avg NCR closure time"
          value={avgClosureLabel}
          caption={closureDurations.length > 0 ? sampleCaption(closureDurations.length) : "No closed NCRs yet"}
        />
        <StatCard
          label="Overdue punch items"
          value={overduePunchItems.length}
          caption={overduePunchItems.length === 0 ? "Nothing overdue" : "Past due date, not yet closed"}
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium text-ink">NCR volume — last 6 months</h2>
            <p className="mt-1 text-sm text-muted">Total NCRs and observations raised per month, all projects.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-danger" /> Major
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-warning" /> Minor
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-info" /> Observation
            </span>
          </div>
        </div>
        <div className="mt-4 flex items-end gap-3">
          {ncrByMonth.map((m) => (
            <div key={m.key} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-28 w-full flex-col items-end justify-end overflow-hidden rounded-t">
                {m.major > 0 && (
                  <div
                    className="w-full bg-danger"
                    style={{ height: `${Math.max(2, (m.major / maxMonthCount) * 100)}%` }}
                    title={`${m.major} major NCRs`}
                  />
                )}
                {m.minor > 0 && (
                  <div
                    className="w-full bg-warning"
                    style={{ height: `${Math.max(2, (m.minor / maxMonthCount) * 100)}%` }}
                    title={`${m.minor} minor NCRs`}
                  />
                )}
                {m.observation > 0 && (
                  <div
                    className="w-full bg-info"
                    style={{ height: `${Math.max(2, (m.observation / maxMonthCount) * 100)}%` }}
                    title={`${m.observation} observations`}
                  />
                )}
                {m.count === 0 && <div className="h-1 w-full bg-border" />}
              </div>
              <span className="text-xs text-muted">{m.key}</span>
              <span className="text-xs font-medium text-ink">{m.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">Project health</h2>
        <p className="mt-1 text-sm text-muted">
          ITP completion, open NCRs and overdue punch items per project — worst first.
        </p>
        {itpByProjectSorted.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No project data yet.</p>
        ) : (
          <div className="mt-3">
            <ResponsiveTable
              columns={healthColumns}
              rows={itpByProjectSorted.slice(0, 12)}
              rowKey={(r) => r.projectId}
              caption="Project health"
              headRowClassName="border-b border-border text-left text-xs uppercase text-muted"
              thClassName="py-2"
              tdClassName="py-2"
            />
          </div>
        )}
      </div>
    </div>
  );
}
