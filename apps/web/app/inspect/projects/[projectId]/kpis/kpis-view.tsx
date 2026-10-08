import { fetchAll } from "@/lib/supabase/fetch-all";
import { loadItemsForSections, loadSectionsForItps } from "@/lib/kpis/queries";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import {
  computeProjectKpis,
  computeQualityByParty,
  computeFirstTimePassRateByDiscipline,
  computeMonthlyTrends,
  computeOverdueItems,
  computePunchListBySource,
  computeOpenHolds,
  type MonthlyTrendPoint,
} from "@/lib/kpis/compute";
import { NCRS_TABLE, NCR_SEVERITIES, type NcrSeverity } from "@/lib/ncrs/types";
import { OpenItemsTable } from "./open-items-table";
import { KpiDrilldown } from "./kpi-drilldown";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";
import { PageGuide } from "@/components/domain/page-guide";
import { getDataBookReadiness } from "@/lib/databook/readiness-cached";

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatHours(value: number | null): string {
  if (value === null) return "—";
  if (value < 48) return `${Math.round(value)} h`;
  return `${(value / 24).toFixed(1)} d`;
}

type Tone = "success" | "warning" | "danger" | "neutral";

/**
 * Tone thresholds for the client-facing KPI tiles. These are deliberately generous, industry-typical
 * bands for construction QA work — not contractual targets — chosen so the badge reads as a quick
 * "is this healthy" signal at a glance rather than a precise pass/fail gate:
 *  - First-time pass rate: >=90% is a strong result for first-attempt inspections, 70-89% is
 *    workable but worth watching, <70% signals a real rework/quality problem.
 *  - Hold-point turnaround & NCR close-out (lower is better): <=24h / <=72h respectively is a same-
 *    or next-day response (good), up to 72h / 7 days is a normal admin lag (watch), beyond that
 *    something is stuck.
 *  - Data-book readiness, inspection completion, ITP completion: these track progress toward 100%
 *    completion rather than a quality rate, so the bar is a little higher — >=90% essentially done,
 *    60-89% in progress, <60% still early / lagging.
 * A null value (no data yet) always renders neutral — there's nothing to judge yet.
 */
function tonePercent(value: number | null, { good, ok }: { good: number; ok: number }): Tone {
  if (value === null) return "neutral";
  if (value >= good) return "success";
  if (value >= ok) return "warning";
  return "danger";
}

function toneHoursLowerBetter(value: number | null, { good, ok }: { good: number; ok: number }): Tone {
  if (value === null) return "neutral";
  if (value <= good) return "success";
  if (value <= ok) return "warning";
  return "danger";
}

const KPI_TONE_LABEL: Record<Tone, string> = { success: "Good", warning: "Watch", danger: "Attention", neutral: "No data" };

function KpiToneBadge({ tone }: { tone: Tone }) {
  if (tone === "neutral") return null;
  return <Badge tone={tone}>{KPI_TONE_LABEL[tone]}</Badge>;
}

const NCR_SEVERITY_LABEL: Record<NcrSeverity, string> = {
  major_ncr: "Major",
  minor_ncr: "Minor",
  observation: "Observation",
};

const NCR_SEVERITY_COLOR: Record<NcrSeverity, string> = {
  major_ncr: "fill-danger",
  minor_ncr: "fill-gold",
  observation: "fill-muted",
};

/** Small hand-rolled SVG progress ring — no chart library, just real percentages already computed above. */
function ProgressRing({ percent, size = 72 }: { percent: number | null; size?: number }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const pct = percent ?? 0;
  const offset = circumference * (1 - pct / 100);
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} style={{ maxWidth: "100%" }} role="img" aria-label={`${Math.round(pct)}% ready`}>
      <circle cx="36" cy="36" r={radius} fill="none" stroke="currentColor" className="text-border" strokeWidth="8" />
      {percent !== null && (
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-burgundy"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 36 36)"
        />
      )}
      <text x="36" y="41" textAnchor="middle" fontSize="16" fontWeight="600" fill="currentColor" className="text-ink">
        {percent === null ? "—" : `${Math.round(percent)}%`}
      </text>
    </svg>
  );
}

/** Horizontal bar chart of real per-ITP inspection-completion percentages (no fabricated trend data). */
function ItpCompletionChart({ rows }: { rows: { label: string; percent: number; completed: number; planned: number }[] }) {
  const rowHeight = 26;
  const chartWidth = 520;
  const height = rows.length * rowHeight + 10;
  return (
    <svg viewBox={`0 0 ${chartWidth} ${height}`} width="100%" style={{ maxWidth: "100%" }} role="img" aria-label="ITP inspection completion by ITP">
      {rows.map((row, i) => {
        const y = i * rowHeight;
        const barMaxWidth = chartWidth - 260;
        const barWidth = Math.max(2, (row.percent / 100) * barMaxWidth);
        return (
          <g key={row.label} transform={`translate(0, ${y})`}>
            <text x="0" y={16} fontSize="12" fill="currentColor" className="text-ink">
              {row.label.length > 20 ? `${row.label.slice(0, 19)}…` : row.label}
            </text>
            <rect x="150" y="4" width={barMaxWidth} height="14" rx="3" fill="currentColor" className="text-border" />
            <rect x="150" y="4" width={barWidth} height="14" rx="3" fill="currentColor" className="text-burgundy" />
            <text x={150 + barMaxWidth + 8} y={16} fontSize="12" fill="currentColor" className="text-ink">
              {Math.round(row.percent)}% ({row.completed}/{row.planned})
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Simple bar chart of real NCR counts by severity. */
function NcrSeverityChart({ counts }: { counts: Record<NcrSeverity, number> }) {
  const total = NCR_SEVERITIES.reduce((sum, sev) => sum + counts[sev], 0);
  const max = Math.max(1, ...NCR_SEVERITIES.map((sev) => counts[sev]));
  const barWidth = 60;
  const gap = 30;
  const chartHeight = 110;
  const width = NCR_SEVERITIES.length * (barWidth + gap);
  return (
    <svg viewBox={`0 0 ${width} ${chartHeight + 30}`} width="100%" style={{ maxWidth: 320 }} role="img" aria-label="NCR count by severity">
      {NCR_SEVERITIES.map((sev, i) => {
        const count = counts[sev];
        const barHeight = total === 0 ? 0 : Math.max(2, (count / max) * chartHeight);
        const x = i * (barWidth + gap) + gap / 2;
        const y = chartHeight - barHeight;
        return (
          <g key={sev}>
            <rect x={x} y={y} width={barWidth} height={barHeight} rx="3" fill="currentColor" className={NCR_SEVERITY_COLOR[sev]} />
            <text x={x + barWidth / 2} y={chartHeight - barHeight - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor" className="text-ink">
              {count}
            </text>
            <text x={x + barWidth / 2} y={chartHeight + 18} textAnchor="middle" fontSize="12" fill="currentColor" className="text-muted">
              {NCR_SEVERITY_LABEL[sev]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Grouped monthly bar chart for the two real trend series (NCR volume, inspections completed).
 * Only ever plots the months returned by computeMonthlyTrends — which is already clipped to the
 * project's own created_at month, so no fabricated "zero" history is ever drawn here.
 */
function MonthlyTrendChart({ points }: { points: MonthlyTrendPoint[] }) {
  const groupWidth = 70;
  const barWidth = 22;
  const gap = 6;
  const chartHeight = 120;
  const width = points.length * groupWidth;
  const max = Math.max(1, ...points.map((p) => Math.max(p.ncrCount, p.inspectionsCompletedCount)));

  return (
    <svg
      viewBox={`0 0 ${width} ${chartHeight + 40}`}
      width="100%"
      style={{ maxWidth: Math.max(width, 320) }}
      role="img"
      aria-label="Monthly NCR volume and inspections completed"
    >
      {points.map((point, i) => {
        const groupX = i * groupWidth;
        const ncrHeight = point.ncrCount === 0 ? 0 : Math.max(2, (point.ncrCount / max) * chartHeight);
        const inspHeight = point.inspectionsCompletedCount === 0 ? 0 : Math.max(2, (point.inspectionsCompletedCount / max) * chartHeight);
        const ncrX = groupX + (groupWidth - (barWidth * 2 + gap)) / 2;
        const inspX = ncrX + barWidth + gap;
        return (
          <g key={point.monthStart}>
            <rect x={ncrX} y={chartHeight - ncrHeight} width={barWidth} height={ncrHeight} rx="2" fill="currentColor" className="text-danger" />
            <text x={ncrX + barWidth / 2} y={chartHeight - ncrHeight - 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor" className="text-ink">
              {point.ncrCount}
            </text>
            <rect x={inspX} y={chartHeight - inspHeight} width={barWidth} height={inspHeight} rx="2" fill="currentColor" className="text-burgundy" />
            <text x={inspX + barWidth / 2} y={chartHeight - inspHeight - 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor" className="text-ink">
              {point.inspectionsCompletedCount}
            </text>
            <text x={groupX + groupWidth / 2} y={chartHeight + 18} textAnchor="middle" fontSize="12" fill="currentColor" className="text-muted">
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Client-facing KPI dashboard (Reqs R89-R90). Scoped to a single project, taken only from the URL
// route param — every query in computeProjectKpis is filtered by that project id explicitly, on
// top of (not instead of) has_org_access RLS, so a mistake here can never widen into a
// cross-project or cross-tenant aggregate. This page must never show JAGS-internal costs/margins
// or anything resembling the internal Power BI command centre — nothing it reads or renders here
// does.
export async function KpisView({ projectId, embedded = false }: { projectId: string; embedded?: boolean }) {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, created_at, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; project_number: string; name: string; created_at: string; organizations: { name: string } | null }>();

  if (!project) notFound();

  const [kpis, qualityByParty, qualityByDiscipline, monthlyTrends, itps, ncrSeverityRows, overdueItems, punchBySource, openHolds, readiness] = await Promise.all([
    computeProjectKpis(supabase, projectId),
    computeQualityByParty(supabase, projectId),
    computeFirstTimePassRateByDiscipline(supabase, projectId),
    computeMonthlyTrends(supabase, projectId, project.created_at),
    fetchAll<{ id: string; itp_number: string; title: string; status: string }>((from, to) =>
      supabase
        .from("itps")
        .select("id, itp_number, title, status")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to)
        .returns<{ id: string; itp_number: string; title: string; status: string }[]>()
    ),
    fetchAll<{ severity: NcrSeverity }>((from, to) =>
      supabase.from(NCRS_TABLE).select("severity").eq("project_id", projectId).order("id").range(from, to).returns<{ severity: NcrSeverity }[]>()
    ),
    computeOverdueItems(supabase, projectId),
    computePunchListBySource(supabase, projectId),
    computeOpenHolds(supabase, projectId),
    getDataBookReadiness(session.userId, projectId).catch(() => null),
  ]);
  const readinessPercent = readiness ? readiness.overallPercentage : null;

  // Real per-ITP inspection-completion chart data — same "evidence-type-1 item has a recorded
  // result" methodology as kpis.inspectionsCompletionRate above, just grouped per ITP instead of
  // aggregated project-wide. No historical/trend data is invented here, only current counts.
  const itpIds = itps.map((itp) => itp.id);
  const sections = await loadSectionsForItps(supabase, itpIds);
  const sectionIds = sections.map((sec) => sec.id);
  const sectionToItp = new Map(sections.map((sec) => [sec.id, sec.itp_id]));

  const items = await loadItemsForSections<{ id: string; section_id: string; evidence_type: 1 | 2 | 3 }>(
    supabase,
    sectionIds,
    "id, section_id, evidence_type"
  );
  const itemToItp = new Map(items.map((item) => [item.id, sectionToItp.get(item.section_id) ?? null]));

  const records =
    items.length > 0
      ? await fetchAll<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null }>((from, to) =>
          supabase
            .from("inspection_records")
            .select("itp_item_id, overall_result")
            .eq("project_id", projectId)
            .order("id")
            .range(from, to)
            .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null }[]>()
        )
      : [];
  const completedItemIds = new Set(records.filter((r) => r.overall_result !== null).map((r) => r.itp_item_id));

  const itpCompletionRows = itps
    .map((itp) => {
      const plannedItems = items.filter((item) => item.evidence_type === 1 && itemToItp.get(item.id) === itp.id);
      const completed = plannedItems.filter((item) => completedItemIds.has(item.id)).length;
      const planned = plannedItems.length;
      return {
        label: itp.itp_number ? `${itp.itp_number} ${itp.title}` : itp.title,
        percent: planned > 0 ? (completed / planned) * 100 : 0,
        completed,
        planned,
      };
    })
    .filter((row) => row.planned > 0)
    .sort((a, b) => b.percent - a.percent);

  const ncrSeverityCounts: Record<NcrSeverity, number> = { major_ncr: 0, minor_ncr: 0, observation: 0 };
  for (const row of ncrSeverityRows) {
    ncrSeverityCounts[row.severity] += 1;
  }
  const totalNcrs = NCR_SEVERITIES.reduce((sum, sev) => sum + ncrSeverityCounts[sev], 0);

  const Heading = embedded ? "h2" : "h1";
  return (
    <div>
      <RealtimeRefresh table="inspection_records" filter={`project_id=eq.${projectId}`} />
      {!embedded && (
        <Link href={`/inspect/projects/${projectId}`} className="text-sm text-burgundy hover:underline">
          ← Back to Project
        </Link>
      )}
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className="text-2xl font-semibold text-ink">Quality performance</Heading>
          <PageGuide
            title="Client KPIs — how this works"
            points={[
              "Client-facing quality metrics for this one project only: first-time pass rate, hold-point turnaround, NCR close-out time, data-book readiness (a proxy), inspection and ITP completion.",
              "Every number and chart here is computed live from this project's own recorded ITPs, inspections, NCRs, sign-offs and punch list — nothing is fabricated trend data or JAGS-internal cost/margin figures.",
              "\"Open Holds\" (currently blocked, ranked by how long they've been waiting) is distinct from \"Hold-point turnaround\" above, which only averages Holds that have already closed.",
              "Reachable by any role with access to this project — no staff-only gate.",
            ]}
          />
        </div>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · <span className="doc-id">{project.project_number}</span> {project.name}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiDrilldown
          records={kpis.firstAttemptRecords}
          trigger={
            <StatCard
              label="First-time pass rate"
              caption="Share of checklist items whose first completed inspection passed. Drafts excluded. Click to see the records."
              value={formatPercent(kpis.firstTimePassRate)}
              icon={<KpiToneBadge tone={tonePercent(kpis.firstTimePassRate, { good: 90, ok: 70 })} />}
            />
          }
        />
        <StatCard
          label="Hold-point turnaround"
          href="/inspect/start-work"
          caption="Average time from Hold notification to sign-off. Click for the start-work list."
          value={formatHours(kpis.holdPointTurnaroundHours)}
          icon={
            <span className="flex items-center gap-2">
              {kpis.holdPointTurnaroundSource && (
                <span className="text-xs text-muted">
                  {kpis.holdPointTurnaroundSource === "signoff_chain" ? "sign-off" : "approval proxy"}
                </span>
              )}
              <KpiToneBadge tone={toneHoursLowerBetter(kpis.holdPointTurnaroundHours, { good: 24, ok: 72 })} />
            </span>
          }
        />
        <StatCard
          label="NCR close-out time"
          href="/inspect/ncrs"
          caption="Average time from NCR raised to closed (closed NCRs only). Click for the NCR register."
          value={formatHours(kpis.ncrCloseOutHours)}
          icon={<KpiToneBadge tone={toneHoursLowerBetter(kpis.ncrCloseOutHours, { good: 72, ok: 168 })} />}
        />
        <StatCard
          label="Data-book readiness"
          href={`/inspect/projects/${projectId}/data-book`}
          caption="Real readiness across all Data Book categories (open punch items must also be zero)."
          value={
            <span className="flex items-center gap-3">
              {formatPercent(readinessPercent)}
              <ProgressRing percent={readinessPercent} size={40} />
            </span>
          }
          icon={
            <span className="flex items-center gap-2">
              <KpiToneBadge tone={tonePercent(readinessPercent, { good: 90, ok: 60 })} />
            </span>
          }
        />
        <StatCard
          label="Inspections completed"
          href={`/inspect/inspections?project=${projectId}`}
          caption="Completed inspection records versus planned inspection items on approved ITPs."
          value={`${kpis.inspectionsCompleted} / ${kpis.inspectionsPlanned} (${formatPercent(kpis.inspectionsCompletionRate)})`}
          icon={<KpiToneBadge tone={tonePercent(kpis.inspectionsCompletionRate, { good: 90, ok: 60 })} />}
        />
        <StatCard
          label="ITP completion"
          href={`/inspect/itps?project=${projectId}`}
          caption="ITPs accepted by the client as a share of all ITPs on this project."
          value={formatPercent(kpis.itpCompletionRate)}
          icon={<KpiToneBadge tone={tonePercent(kpis.itpCompletionRate, { good: 90, ok: 60 })} />}
        />
      </div>

      {/* Real UX gap found live: these 5 list-style panels used to each be a full-width stacked
          card (mt-8 apart), forcing a long scroll to reach the charts below on any project with a
          few open items — a 2-column grid on wider screens halves that without losing anything,
          since none of these actually need full page width to read well. Charts below stay full
          width — they genuinely benefit from the horizontal room. */}
      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
      {overdueItems.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4">
          <h2 className="font-medium text-danger">Overdue — past due date</h2>
          <div className="mt-1 flex gap-3 text-xs"><Link href="/inspect/ncrs" className="text-burgundy hover:underline">NCR register</Link><Link href={`/inspect/projects/${projectId}/punch-list`} className="text-burgundy hover:underline">Punch list</Link></div>
          <p className="mt-1 text-sm text-muted">
            {overdueItems.length} open item{overdueItems.length === 1 ? "" : "s"} (NCRs and punch list) past their due date.
          </p>
          <ul className="mt-3 space-y-2">
            {overdueItems.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-surface px-3 py-2 text-sm">
                <span>
                  <span className="mr-2 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium uppercase text-danger">
                    {item.kind === "ncr" ? "NCR" : "Punch"}
                  </span>
                  <span className="doc-id text-ink">{item.reference}</span>
                  <span className="ml-2 text-muted">{item.description}</span>
                </span>
                <span className="tabular-nums text-xs font-semibold text-danger">
                  {item.daysOverdue} day{item.daysOverdue === 1 ? "" : "s"} overdue
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openHolds.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Open Holds — how long work has actually been stopped</h2>
          <Link href="/inspect/start-work" className="text-xs text-burgundy hover:underline">Open the start-work list</Link>
          <p className="mt-1 text-sm text-muted">
            Every currently open blocking sign-off, ranked longest-waiting first — distinct from the average
            hold-point turnaround above, which only reflects Holds that have already closed.
          </p>
          <ul className="mt-3 space-y-2">
            {openHolds.map((hold) => (
              <li key={`${hold.itpItemId}-${hold.partyName}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm last:border-0">
                <span>
                  <span className="doc-id text-muted">{hold.itpNumber}</span>
                  <span className="ml-2 text-ink">{hold.activity}</span>
                  <span className="ml-2 text-xs text-muted">— waiting on {hold.partyName}</span>
                </span>
                <span className="tabular-nums text-xs font-semibold text-ink">
                  {hold.hoursOpen === null ? "—" : formatHours(hold.hoursOpen)} open
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {punchBySource.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Punch list by source</h2>
          <p className="mt-1 text-sm text-muted">Where every punch list item actually came from — open vs. closed, by origin.</p>
          <ol className="mt-4 space-y-3">
            {punchBySource.map((row) => {
              const total = row.openCount + row.closedCount;
              const openPct = total > 0 ? (row.openCount / total) * 100 : 0;
              return (
                <li key={row.source} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm text-ink">{row.label}</span>
                  <div className="h-2 flex-1 rounded-full bg-border">
                    <div className="h-2 rounded-full bg-danger" style={{ width: `${openPct}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right text-xs text-muted tabular-nums">
                    {row.openCount} open / {row.closedCount} closed
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {qualityByParty.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Quality by party</h2>
          <p className="mt-1 text-sm text-muted">
            Sign-off completion rate and NCR count per project party, ranked by sign-off rate highest to lowest.
          </p>
          <ol className="mt-4 space-y-3">
            {qualityByParty.map((row, index) => (
              <li key={row.partyName} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-sm text-muted">{index + 1}</span>
                <span className="w-36 shrink-0 truncate text-sm text-ink">{row.partyName}</span>
                <div className="h-2 flex-1 rounded-full bg-border">
                  <div className="h-2 rounded-full bg-burgundy" style={{ width: `${row.percentage ?? 0}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-sm font-medium text-ink">
                  {row.percentage === null ? "—" : `${row.percentage}%`}
                </span>
                <span className="w-20 shrink-0 text-right text-xs text-muted">
                  {row.ncrCount} NCR{row.ncrCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {qualityByDiscipline.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Quality by discipline</h2>
          <p className="mt-1 text-sm text-muted">First-time pass rate per discipline, ranked highest to lowest.</p>
          <ol className="mt-4 space-y-3">
            {qualityByDiscipline.map((row, index) => (
              <li key={row.disciplineCode} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-sm text-muted">{index + 1}</span>
                <span className="w-36 shrink-0 truncate text-sm text-ink" title={row.disciplineName}>
                  {row.disciplineCode}
                </span>
                <div className="h-2 flex-1 rounded-full bg-border">
                  <div className="h-2 rounded-full bg-burgundy" style={{ width: `${row.rate ?? 0}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-sm font-medium text-ink">{formatPercent(row.rate)}</span>
                <span className="w-20 shrink-0 text-right text-xs text-muted">
                  {row.firstTimePasses}/{row.firstAttempts}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      </div>

      {itpCompletionRows.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Inspection completion by ITP</h2>
          <p className="mt-1 text-sm text-muted">
            Share of planned inspection items with a recorded result, per ITP. Ranked highest to lowest.
          </p>
          <div className="mt-4 text-ink">
            <ItpCompletionChart rows={itpCompletionRows} />
          </div>
        </div>
      )}

      {totalNcrs > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">NCRs by severity</h2>
          <p className="mt-1 text-sm text-muted">{totalNcrs} NCR{totalNcrs === 1 ? "" : "s"} raised on this project to date.</p>
          <div className="mt-4">
            <NcrSeverityChart counts={ncrSeverityCounts} />
          </div>
        </div>
      )}

      {monthlyTrends.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Monthly trend</h2>
          <p className="mt-1 text-sm text-muted">
            NCRs raised and inspections completed per month, since this project began
            {monthlyTrends.length < 6 ? " — history so far, more months will appear over time" : " (last 6 months)"}.
          </p>
          <div className="mt-3 flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" /> NCRs raised
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-burgundy" /> Inspections completed
            </span>
          </div>
          <div className="mt-4 overflow-x-auto text-ink">
            <MonthlyTrendChart points={monthlyTrends} />
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-medium text-ink">Open items</h2>
        <p className="mt-1 text-sm text-muted">Open NCRs and observations, plus any failed inspection on this project.</p>
        <div className="mt-3">
          <OpenItemsTable rows={kpis.openItems} />
        </div>
      </div>
    </div>
  );
}
