import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { AI_USAGE_LOG_TABLE, type AiFeature } from "@/lib/ai/log";
import { FEATURE_CATEGORY, type AiFeatureCategory } from "@/lib/ai/feature-categories";
import { estimateGeminiCallCostUsd, formatUsd } from "@/lib/ai/pricing";
import {
  BACKGROUND_JOBS_TABLE,
  type MonthlyReportPackPayload,
  type RenderFatReportPdfPayload,
  type RenderInspectionReportPdfPayload,
  type RenderItpPdfPayload,
  type RenderPortfolioSummaryPdfPayload,
} from "@/lib/reports/types";
import { PageGuide } from "@/components/domain/page-guide";
import { ProjectFilter } from "./project-filter";
import { SettingsBackLink } from "@/app/inspect/settings/settings-back-link";

/**
 * Admin-only "Usage & Cost" view — a CEO-level strategy review flagged that this app has real
 * variable costs (Gemini AI token spend per apps/web/lib/ai/log.ts, Puppeteer PDF-render compute
 * per background_jobs) with zero per-organisation visibility. This is read-only reporting: AI
 * feature invocation counts (ai_usage_log) and PDF render job counts/durations (background_jobs),
 * broken down per project for a recent window, plus a $ cost ESTIMATE for the AI side using
 * Google's own published Gemini API pricing (lib/ai/pricing.ts) against the real token counts Gemini
 * reports per call (see lib/ai/gemini-provider.ts's withGeminiUsage). No render-job $ estimate is
 * shown — there's no equivalent published per-second rate for the Puppeteer compute this app runs
 * on, so inventing one would be a guess dressed up as a number; render jobs stay a count/duration
 * signal only, same as before.
 *
 * Follows apps/web/app/inspect/organisation/insights/page.tsx's exact pattern: plain RLS-scoped
 * Supabase queries against the base tables, run as the querying admin's own session, rather than an
 * unscoped analytics view. See that page's own header comment and
 * supabase/migrations/20260916140000_grant_powerbi_views_to_authenticated.sql for why a shared
 * "all orgs" view granted to the `authenticated` role is the wrong shape here.
 */

const WINDOW_DAYS = 30;

interface ProjectRow {
  id: string;
  project_number: string;
  name: string;
  organization_id: string;
  organizations: { name: string } | null;
}

interface AiUsageLogRow {
  organization_id: string;
  project_id: string | null;
  feature: AiFeature;
  model_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface BackgroundJobWindowRow {
  job_type: string;
  payload:
    | MonthlyReportPackPayload
    | RenderItpPdfPayload
    | RenderInspectionReportPdfPayload
    | RenderFatReportPdfPayload
    | RenderPortfolioSummaryPdfPayload;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
}

function averageSeconds(durations: number[]): number | null {
  if (durations.length === 0) return null;
  return durations.reduce((sum, d) => sum + d, 0) / durations.length;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

interface ProjectUsage {
  projectId: string;
  project: ProjectRow | null;
  aiCalls: number;
  aiCostUsd: number;
  aiCostKnown: boolean; // false when every call's cost is unestimable (unrecognized model/no tokens)
  aiByCategory: Partial<Record<AiFeatureCategory, { calls: number; costUsd: number; costKnown: boolean }>>;
  jobCount: number;
  jobDurations: number[];
}

export default async function UsageAndCostPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const { project: selectedProjectId } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);
  const windowStartIso = windowStart.toISOString();

  const [{ data: aiRows }, { data: jobRows }] = await Promise.all([
    supabase
      .from(AI_USAGE_LOG_TABLE)
      .select("organization_id, project_id, feature, model_id, input_tokens, output_tokens, created_at")
      .gte("created_at", windowStartIso)
      .returns<AiUsageLogRow[]>(),
    supabase
      .from(BACKGROUND_JOBS_TABLE)
      .select("job_type, payload, status, created_at, completed_at")
      .gte("created_at", windowStartIso)
      .returns<BackgroundJobWindowRow[]>(),
  ]);

  const jobs = jobRows ?? [];

  // --- Resolve each render job back to a project, where the payload allows it ---
  const itpIds = jobs
    .filter((j) => j.job_type === "render_itp_pdf")
    .map((j) => (j.payload as RenderItpPdfPayload).itp_id);
  const inspectionRecordIds = jobs
    .filter((j) => j.job_type === "render_inspection_report_pdf")
    .map((j) => (j.payload as RenderInspectionReportPdfPayload).inspection_record_id);
  const assignmentIds = jobs
    .filter((j) => j.job_type === "render_fat_report_pdf")
    .map((j) => (j.payload as RenderFatReportPdfPayload).assignment_id);

  const [{ data: itps }, { data: inspectionRecords }, { data: assignments }] = await Promise.all([
    itpIds.length
      ? supabase.from("itps").select("id, project_id").in("id", itpIds).returns<{ id: string; project_id: string }[]>()
      : Promise.resolve({ data: [] as { id: string; project_id: string }[] }),
    inspectionRecordIds.length
      ? supabase
          .from("inspection_records")
          .select("id, project_id")
          .in("id", inspectionRecordIds)
          .returns<{ id: string; project_id: string }[]>()
      : Promise.resolve({ data: [] as { id: string; project_id: string }[] }),
    assignmentIds.length
      ? supabase
          .from("standalone_assignments")
          .select("id, project_id")
          .in("id", assignmentIds)
          .returns<{ id: string; project_id: string }[]>()
      : Promise.resolve({ data: [] as { id: string; project_id: string }[] }),
  ]);

  const itpToProject = new Map((itps ?? []).map((i) => [i.id, i.project_id]));
  const inspectionRecordToProject = new Map((inspectionRecords ?? []).map((r) => [r.id, r.project_id]));
  const assignmentToProject = new Map((assignments ?? []).map((a) => [a.id, a.project_id]));

  function resolveJobProjectId(job: BackgroundJobWindowRow): string | null {
    switch (job.job_type) {
      case "render_itp_pdf":
        return itpToProject.get((job.payload as RenderItpPdfPayload).itp_id) ?? null;
      case "render_inspection_report_pdf":
        return inspectionRecordToProject.get((job.payload as RenderInspectionReportPdfPayload).inspection_record_id) ?? null;
      case "render_fat_report_pdf":
        return assignmentToProject.get((job.payload as RenderFatReportPdfPayload).assignment_id) ?? null;
      case "generate_monthly_report_pack":
      case "render_portfolio_summary_pdf":
      default:
        return null; // org-wide or portfolio-wide — no single project to attribute this to
    }
  }

  function durationSeconds(job: BackgroundJobWindowRow): number | null {
    if (job.status !== "completed" || !job.completed_at) return null;
    return (new Date(job.completed_at).getTime() - new Date(job.created_at).getTime()) / 1000;
  }

  // --- Which projects to even fetch: every project_id seen on an AI row or a resolvable render job ---
  const projectIds = new Set<string>();
  for (const row of aiRows ?? []) if (row.project_id) projectIds.add(row.project_id);
  for (const job of jobs) {
    const pid = resolveJobProjectId(job);
    if (pid) projectIds.add(pid);
  }

  const { data: projects } = projectIds.size
    ? await supabase
        .from("projects")
        .select("id, project_number, name, organization_id, organizations(name)")
        .in("id", [...projectIds])
        .returns<ProjectRow[]>()
    : { data: [] as ProjectRow[] };
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));

  // --- Per-call AI cost estimate + per-project/category aggregation ---
  const usageByProject = new Map<string, ProjectUsage>();
  function getProjectUsage(projectId: string): ProjectUsage {
    let row = usageByProject.get(projectId);
    if (!row) {
      row = {
        projectId,
        project: projectById.get(projectId) ?? null,
        aiCalls: 0,
        aiCostUsd: 0,
        aiCostKnown: true,
        aiByCategory: {},
        jobCount: 0,
        jobDurations: [],
      };
      usageByProject.set(projectId, row);
    }
    return row;
  }

  let orgWideAiCalls = 0; // ai_usage_log rows with no project_id (predate this column, or a genuinely org-wide feature)
  let totalAiCalls = 0;
  let totalAiCostUsd = 0;
  let totalAiCostFullyKnown = true;

  const costByModel = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costUsd: number; costKnown: boolean }>();
  const costByCategory = new Map<AiFeatureCategory, { calls: number; costUsd: number; costKnown: boolean }>();

  for (const row of aiRows ?? []) {
    totalAiCalls += 1;
    const { costUsd } = estimateGeminiCallCostUsd(row.model_id, row.input_tokens, row.output_tokens);
    if (costUsd !== null) totalAiCostUsd += costUsd;
    else totalAiCostFullyKnown = false;

    const modelKey = row.model_id ?? "unknown model";
    const modelEntry = costByModel.get(modelKey) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, costKnown: true };
    modelEntry.calls += 1;
    modelEntry.inputTokens += row.input_tokens ?? 0;
    modelEntry.outputTokens += row.output_tokens ?? 0;
    if (costUsd !== null) modelEntry.costUsd += costUsd;
    else modelEntry.costKnown = false;
    costByModel.set(modelKey, modelEntry);

    const category = FEATURE_CATEGORY[row.feature];
    const categoryEntry = costByCategory.get(category) ?? { calls: 0, costUsd: 0, costKnown: true };
    categoryEntry.calls += 1;
    if (costUsd !== null) categoryEntry.costUsd += costUsd;
    else categoryEntry.costKnown = false;
    costByCategory.set(category, categoryEntry);

    if (!row.project_id) {
      orgWideAiCalls += 1;
      continue;
    }
    const proj = getProjectUsage(row.project_id);
    proj.aiCalls += 1;
    if (costUsd !== null) proj.aiCostUsd += costUsd;
    else proj.aiCostKnown = false;
    const projCategoryEntry = proj.aiByCategory[category] ?? { calls: 0, costUsd: 0, costKnown: true };
    projCategoryEntry.calls += 1;
    if (costUsd !== null) projCategoryEntry.costUsd += costUsd;
    else projCategoryEntry.costKnown = false;
    proj.aiByCategory[category] = projCategoryEntry;
  }

  let portfolioWideJobTotal = 0;
  const totalRenderDurations: number[] = [];

  for (const job of jobs) {
    const pid = resolveJobProjectId(job);
    const duration = durationSeconds(job);
    if (duration !== null) totalRenderDurations.push(duration);
    if (pid) {
      const proj = getProjectUsage(pid);
      proj.jobCount += 1;
      if (duration !== null) proj.jobDurations.push(duration);
    } else {
      portfolioWideJobTotal += 1;
    }
  }

  const allProjectRows = [...usageByProject.values()].sort((a, b) => b.aiCostUsd - a.aiCostUsd || b.aiCalls - a.aiCalls);
  const topCostProjectId = allProjectRows[0]?.projectId ?? null;

  const filteredProjectRows = selectedProjectId
    ? allProjectRows.filter((r) => r.projectId === selectedProjectId)
    : allProjectRows;

  const totalRenderSeconds = totalRenderDurations.reduce((sum, d) => sum + d, 0);

  const projectFilterOptions = (projects ?? [])
    .slice()
    .sort((a, b) => a.project_number.localeCompare(b.project_number))
    .map((p) => ({ id: p.id, label: `${p.project_number} — ${p.name}` }));

  const CATEGORY_ORDER: AiFeatureCategory[] = [
    "Drafting & Generation",
    "Extraction",
    "Review & Suggestions",
    "Translation & Cleanup",
  ];

  return (
    <div className="max-w-6xl">
      <SettingsBackLink href="/inspect/settings?section=insights" />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">Usage &amp; Cost</h1>
            <PageGuide
              title="Usage & Cost — how this works"
              points={[
                "Admin-only, read-only cost-visibility reporting for the last 30 days — AI feature invocation counts with a $ cost ESTIMATE, and PDF render job counts/durations, filterable to one project.",
                "The AI cost estimate uses Google's own published Gemini API list pricing (ai.google.dev/pricing) against the REAL input/output token counts Gemini reports for each call — not a flat per-call guess. It is still an estimate: actual billing depends on the real contract (e.g. Vertex AI committed-use pricing differs from the public API), and a model this app doesn't recognize, or a call logged before token tracking existed, shows as \"—\" rather than a misleading $0.00.",
                "No $ estimate is shown for PDF render jobs — there's no published per-second rate for the Puppeteer compute this runs on, so render jobs stay a count/duration signal only, same as before this page's redesign.",
                "A render job or AI call is attributed to a project via its payload/caller context (e.g. an ITP PDF's itp_id → project); a genuinely org-wide/portfolio-wide feature (e.g. the monthly report pack, or the one-click portfolio summary PDF) has no single project and is shown separately.",
                "Computed from the same base tables (ai_usage_log, background_jobs) through the querying admin's own RLS-scoped session — not an unscoped analytics view — the same pattern as Portfolio Insights.",
              ]}
            />
          </div>
          <p className="mt-1 text-sm text-muted">
            AI feature invocations (with an estimated $ cost) and PDF render job volume, last {WINDOW_DAYS} days.
            Read-only reporting; no billing or pricing-tier decisions are made here. Admin-only.
          </p>
        </div>
        {projectFilterOptions.length > 0 && <ProjectFilter projects={projectFilterOptions} />}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total AI calls" value={totalAiCalls} />
        <StatCard
          label="Est. total AI cost"
          value={formatUsd(totalAiCostUsd)}
          caption={totalAiCostFullyKnown ? `Over ${WINDOW_DAYS} days` : "Some calls unestimable — see Guide"}
        />
        <StatCard label="Total render jobs" value={jobs.length} />
        <StatCard label="Total render time" value={formatDuration(totalRenderSeconds || null)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">AI cost by model</h2>
          <p className="mt-1 text-sm text-muted">Real token counts × Google's published Gemini API pricing.</p>
          {costByModel.size === 0 ? (
            <p className="mt-3 text-sm text-muted">No AI calls in this window.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted">
                  <th className="py-2 pr-2">Model</th>
                  <th className="py-2 pr-2 text-right">Calls</th>
                  <th className="py-2 pr-2 text-right">Tokens in / out</th>
                  <th className="py-2 text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {[...costByModel.entries()]
                  .sort((a, b) => b[1].costUsd - a[1].costUsd)
                  .map(([model, entry]) => (
                    <tr key={model} className="border-b border-border last:border-0">
                      <td className="py-2 pr-2 font-mono text-xs text-ink">{model}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-ink">{entry.calls}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-muted">
                        {formatTokens(entry.inputTokens)} / {formatTokens(entry.outputTokens)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-ink">
                        {entry.costKnown ? formatUsd(entry.costUsd) : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">AI cost by category</h2>
          <p className="mt-1 text-sm text-muted">Which kind of AI work is driving the spend.</p>
          {costByCategory.size === 0 ? (
            <p className="mt-3 text-sm text-muted">No AI calls in this window.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted">
                  <th className="py-2 pr-2">Category</th>
                  <th className="py-2 pr-2 text-right">Calls</th>
                  <th className="py-2 text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {CATEGORY_ORDER.filter((c) => costByCategory.has(c)).map((category) => {
                  const entry = costByCategory.get(category)!;
                  return (
                    <tr key={category} className="border-b border-border last:border-0">
                      <td className="py-2 pr-2 text-ink">{category}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-ink">{entry.calls}</td>
                      <td className="py-2 text-right tabular-nums text-ink">
                        {entry.costKnown ? formatUsd(entry.costUsd) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-ink">
            {selectedProjectId ? "Project cost detail" : "Cost by project — highest first"}
          </h2>
          {!selectedProjectId && allProjectRows.length > 0 && (
            <span className="text-xs text-muted">{allProjectRows.length} project(s) with usage in this window</span>
          )}
        </div>
        {filteredProjectRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {selectedProjectId ? "No AI or render usage for this project in this window." : "No AI or render usage in this window."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted">
                  <th className="py-2 pr-3">Project</th>
                  <th className="py-2 pr-3 text-right">AI calls</th>
                  <th className="py-2 pr-3 text-right">Est. AI cost</th>
                  <th className="py-2 pr-3 text-right">Render jobs</th>
                  <th className="py-2 text-right">Avg render time</th>
                </tr>
              </thead>
              <tbody>
                {filteredProjectRows.map((row) => (
                  <tr key={row.projectId} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="text-ink">
                          <span className="doc-id">{row.project?.project_number ?? "—"}</span> — {row.project?.name ?? "Unknown project"}
                        </span>
                        {row.projectId === topCostProjectId && row.aiCostUsd > 0 && <Badge tone="gold">Highest cost</Badge>}
                      </span>
                      <span className="block text-xs text-muted">{row.project?.organizations?.name ?? "—"}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink">{row.aiCalls}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink">
                      {row.aiCalls > 0 ? (row.aiCostKnown ? formatUsd(row.aiCostUsd) : "—") : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink">{row.jobCount}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{formatDuration(averageSeconds(row.jobDurations))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedProjectId && filteredProjectRows[0] && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">AI cost by category, this project</p>
            {Object.keys(filteredProjectRows[0].aiByCategory).length === 0 ? (
              <p className="mt-1 text-sm text-muted">No AI calls for this project in this window.</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm">
                {CATEGORY_ORDER.filter((c) => filteredProjectRows[0].aiByCategory[c]).map((category) => {
                  const entry = filteredProjectRows[0].aiByCategory[category]!;
                  return (
                    <li key={category} className="flex items-center justify-between">
                      <span className="text-ink">{category}</span>
                      <span className="text-muted">
                        {entry.calls} call{entry.calls === 1 ? "" : "s"} · {entry.costKnown ? formatUsd(entry.costUsd) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {!selectedProjectId && (orgWideAiCalls > 0 || portfolioWideJobTotal > 0) && (
        <div className="mt-6 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium text-ink">Org-wide / portfolio-wide</h2>
          <p className="mt-1 text-sm text-muted">
            AI calls and render jobs with no single project to attribute to (e.g. a report-pack summary, or the
            one-click portfolio summary PDF).
          </p>
          <p className="mt-2 text-sm text-ink">
            {orgWideAiCalls} AI call{orgWideAiCalls === 1 ? "" : "s"} · {portfolioWideJobTotal} render job
            {portfolioWideJobTotal === 1 ? "" : "s"}
          </p>
        </div>
      )}
    </div>
  );
}
