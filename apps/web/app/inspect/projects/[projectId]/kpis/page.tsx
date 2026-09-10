import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { StatCard } from "@/components/ui/stat-card";
import { computeProjectKpis, computeQualityByParty } from "@/lib/kpis/compute";
import { OpenItemsTable } from "./open-items-table";

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatHours(value: number | null): string {
  if (value === null) return "—";
  if (value < 48) return `${Math.round(value)} h`;
  return `${(value / 24).toFixed(1)} d`;
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

  const [kpis, qualityByParty] = await Promise.all([
    computeProjectKpis(supabase, projectId),
    computeQualityByParty(supabase, projectId),
  ]);

  return (
    <div>
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
          value={formatPercent(kpis.dataBookReadiness)}
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
