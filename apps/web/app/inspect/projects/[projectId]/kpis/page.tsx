import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { StatCard } from "@/components/ui/stat-card";
import { computeProjectKpis, computeQualityByParty, computeFirstTimePassRateByDiscipline } from "@/lib/kpis/compute";
import { NCRS_TABLE, NCR_SEVERITIES, type NcrSeverity } from "@/lib/ncrs/types";
import { OpenItemsTable } from "./open-items-table";
import { RealtimeRefresh } from "@/components/domain/realtime-refresh";

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatHours(value: number | null): string {
  if (value === null) return "—";
  if (value < 48) return `${Math.round(value)} h`;
  return `${(value / 24).toFixed(1)} d`;
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
  const chartWidth = 500;
  const height = rows.length * rowHeight + 10;
  return (
    <svg viewBox={`0 0 ${chartWidth} ${height}`} width="100%" style={{ maxWidth: "100%" }} role="img" aria-label="ITP inspection completion by ITP">
      {rows.map((row, i) => {
        const y = i * rowHeight;
        const barMaxWidth = chartWidth - 220;
        const barWidth = Math.max(2, (row.percent / 100) * barMaxWidth);
        return (
          <g key={row.label} transform={`translate(0, ${y})`}>
            <text x="0" y={16} fontSize="11" fill="currentColor" className="text-ink">
              {row.label.length > 22 ? `${row.label.slice(0, 21)}…` : row.label}
            </text>
            <rect x="150" y="4" width={barMaxWidth} height="14" rx="3" fill="currentColor" className="text-border" />
            <rect x="150" y="4" width={barWidth} height="14" rx="3" fill="currentColor" className="text-burgundy" />
            <text x={150 + barMaxWidth + 8} y={16} fontSize="11" fill="currentColor" className="text-ink">
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
            <text x={x + barWidth / 2} y={chartHeight + 18} textAnchor="middle" fontSize="11" fill="currentColor" className="text-muted">
              {NCR_SEVERITY_LABEL[sev]}
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
export default async function ProjectKpisPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_number, name, organizations(name)")
    .eq("id", projectId)
    .maybeSingle<{ id: string; project_number: string; name: string; organizations: { name: string } | null }>();

  if (!project) notFound();

  const [kpis, qualityByParty, qualityByDiscipline, itpsResult, ncrSeverityResult] = await Promise.all([
    computeProjectKpis(supabase, projectId),
    computeQualityByParty(supabase, projectId),
    computeFirstTimePassRateByDiscipline(supabase, projectId),
    supabase
      .from("itps")
      .select("id, itp_number, title, status")
      .eq("project_id", projectId)
      .returns<{ id: string; itp_number: string; title: string; status: string }[]>(),
    supabase.from(NCRS_TABLE).select("severity").eq("project_id", projectId).returns<{ severity: NcrSeverity }[]>(),
  ]);

  // Real per-ITP inspection-completion chart data — same "evidence-type-1 item has a recorded
  // result" methodology as kpis.inspectionsCompletionRate above, just grouped per ITP instead of
  // aggregated project-wide. No historical/trend data is invented here, only current counts.
  const itps = itpsResult.data ?? [];
  const itpIds = itps.map((itp) => itp.id);
  const sectionsResult =
    itpIds.length > 0
      ? await supabase.from("itp_sections").select("id, itp_id").in("itp_id", itpIds).returns<{ id: string; itp_id: string }[]>()
      : { data: [] as { id: string; itp_id: string }[] };
  const sections = sectionsResult.data ?? [];
  const sectionIds = sections.map((s) => s.id);
  const sectionToItp = new Map(sections.map((s) => [s.id, s.itp_id]));

  const itemsResult =
    sectionIds.length > 0
      ? await supabase
          .from("itp_items")
          .select("id, section_id, evidence_type")
          .in("section_id", sectionIds)
          .returns<{ id: string; section_id: string; evidence_type: 1 | 2 | 3 }[]>()
      : { data: [] as { id: string; section_id: string; evidence_type: 1 | 2 | 3 }[] };
  const items = itemsResult.data ?? [];
  const itemToItp = new Map(items.map((item) => [item.id, sectionToItp.get(item.section_id) ?? null]));

  const recordsResult =
    items.length > 0
      ? await supabase
          .from("inspection_records")
          .select("itp_item_id, overall_result")
          .eq("project_id", projectId)
          .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null }[]>()
      : { data: [] as { itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null }[] };
  const records = recordsResult.data ?? [];
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
  for (const row of ncrSeverityResult.data ?? []) {
    ncrSeverityCounts[row.severity] += 1;
  }
  const totalNcrs = NCR_SEVERITIES.reduce((sum, sev) => sum + ncrSeverityCounts[sev], 0);

  return (
    <div>
      <RealtimeRefresh table="inspection_records" filter={`project_id=eq.${projectId}`} />
      <div>
        <h1 className="text-2xl font-semibold text-ink">Quality performance</h1>
        <p className="mt-1 text-sm text-muted">
          {project.organizations?.name} · <span className="doc-id">{project.project_number}</span> {project.name}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="First-time pass rate"
          value={formatPercent(kpis.firstTimePassRate)}
        />
        <StatCard
          label="Hold-point turnaround"
          value={formatHours(kpis.holdPointTurnaroundHours)}
          icon={
            kpis.holdPointTurnaroundSource && (
              <span className="text-xs text-muted">
                {kpis.holdPointTurnaroundSource === "signoff_chain" ? "sign-off" : "approval proxy"}
              </span>
            )
          }
        />
        <StatCard
          label="NCR close-out time"
          value={formatHours(kpis.ncrCloseOutHours)}
        />
        <StatCard
          label="Data-book readiness"
          value={
            <span className="flex items-center gap-3">
              {formatPercent(kpis.dataBookReadiness)}
              <ProgressRing percent={kpis.dataBookReadiness} size={40} />
            </span>
          }
          icon={<span className="text-xs text-muted">proxy</span>}
        />
        <StatCard
          label="Inspections completed"
          value={`${kpis.inspectionsCompleted} / ${kpis.inspectionsPlanned} (${formatPercent(kpis.inspectionsCompletionRate)})`}
        />
        <StatCard
          label="ITP completion"
          value={formatPercent(kpis.itpCompletionRate)}
        />
      </div>

      {qualityByParty.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-medium text-ink">Quality by party</h2>
          <p className="mt-1 text-sm text-muted">Sign-off completion rate per project party, ranked highest to lowest.</p>
          <ol className="mt-4 space-y-3">
            {qualityByParty.map((row, index) => (
              <li key={row.partyName} className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-sm text-muted">{index + 1}</span>
                <span className="w-36 shrink-0 truncate text-sm text-ink">{row.partyName}</span>
                <div className="h-2 flex-1 rounded-full bg-border">
                  <div className="h-2 rounded-full bg-burgundy" style={{ width: `${row.percentage}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-sm font-medium text-ink">{row.percentage}%</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {qualityByDiscipline.length > 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
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
