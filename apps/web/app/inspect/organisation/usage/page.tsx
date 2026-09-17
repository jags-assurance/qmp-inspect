import { redirect } from "next/navigation";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/ui/stat-card";
import { AI_USAGE_LOG_TABLE, type AiFeature } from "@/lib/ai/log";
import {
  BACKGROUND_JOBS_TABLE,
  type MonthlyReportPackPayload,
  type RenderFatReportPdfPayload,
  type RenderInspectionReportPdfPayload,
  type RenderItpPdfPayload,
  type RenderPortfolioSummaryPdfPayload,
} from "@/lib/reports/types";

/**
 * Admin-only "Usage & Cost" view — a CEO-level strategy review flagged that this app has real
 * variable costs (Gemini AI token spend per apps/web/lib/ai/log.ts, Puppeteer PDF-render compute
 * per background_jobs) with zero per-organisation visibility. This is read-only reporting: AI
 * feature invocation counts (ai_usage_log) and PDF render job counts/durations (background_jobs),
 * broken down per organisation for a recent window. No billing, pricing tier, or payment logic
 * here — that is a separate business decision, out of scope.
 *
 * Follows apps/web/app/inspect/organisation/insights/page.tsx's exact pattern: plain RLS-scoped
 * Supabase queries against the base tables, run as the querying admin's own session, rather than an
 * unscoped analytics view. See that page's own header comment and
 * supabase/migrations/20260916140000_grant_powerbi_views_to_authenticated.sql for why a shared
 * "all orgs" view granted to the `authenticated` role is the wrong shape here — it would let ANY
 * logged-in user read every organisation's data directly, bypassing this page's isAdminStaff gate
 * and RLS entirely. ai_usage_log and background_jobs are both already RLS-scoped to JAGS staff
 * (is_jags_staff()) at the table level (see 20260910060000_phase3_ai_usage_log.sql and the
 * background_jobs_select policy history in supabase/migrations), so a global JAGS admin querying
 * them directly here naturally sees the whole portfolio — the same end result a dedicated view
 * would give, without widening what a non-admin session could ever reach.
 */

const WINDOW_DAYS = 30;

const AI_FEATURES: AiFeature[] = [
  "itp_draft",
  "ncr_description_draft",
  "checklist_consistency_check",
  "checklist_generation",
  "report_narrative_draft",
  "ncr_root_cause_suggestion",
  "standalone_measurement_suggestion",
];

interface OrganizationRow {
  id: string;
  name: string;
}

interface AiUsageLogRow {
  organization_id: string;
  feature: AiFeature;
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

interface OrgUsageRow {
  organizationId: string;
  organizationName: string;
  aiTotal: number;
  aiByFeature: Partial<Record<AiFeature, number>>;
  jobTotal: number;
  jobCompletedDurations: number[]; // seconds
  jobByType: Record<string, { count: number; completedDurations: number[] }>;
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

export default async function UsageAndCostPage() {
  const session = await requireSession();
  if (!isAdminStaff(session)) redirect("/inspect");

  const supabase = await createSupabaseServerClient();

  const windowStart = new Date();
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS);
  const windowStartIso = windowStart.toISOString();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name")
    .returns<OrganizationRow[]>();
  const orgById = new Map((organizations ?? []).map((o) => [o.id, o]));

  const [{ data: aiRows }, { data: jobRows }] = await Promise.all([
    supabase
      .from(AI_USAGE_LOG_TABLE)
      .select("organization_id, feature, created_at")
      .gte("created_at", windowStartIso)
      .returns<AiUsageLogRow[]>(),
    supabase
      .from(BACKGROUND_JOBS_TABLE)
      .select("job_type, payload, status, created_at, completed_at")
      .gte("created_at", windowStartIso)
      .returns<BackgroundJobWindowRow[]>(),
  ]);

  const jobs = jobRows ?? [];

  // --- Resolve each render job back to an organisation, where the payload allows it ---
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
      ? supabase
          .from("itps")
          .select("id, project_id")
          .in("id", itpIds)
          .returns<{ id: string; project_id: string }[]>()
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

  const projectIds = new Set<string>();
  for (const row of itps ?? []) projectIds.add(row.project_id);
  for (const row of inspectionRecords ?? []) projectIds.add(row.project_id);
  for (const row of assignments ?? []) projectIds.add(row.project_id);

  const { data: projects } = projectIds.size
    ? await supabase
        .from("projects")
        .select("id, organization_id")
        .in("id", [...projectIds])
        .returns<{ id: string; organization_id: string }[]>()
    : { data: [] as { id: string; organization_id: string }[] };

  const projectToOrg = new Map((projects ?? []).map((p) => [p.id, p.organization_id]));
  const itpToOrg = new Map((itps ?? []).map((i) => [i.id, projectToOrg.get(i.project_id) ?? null]));
  const inspectionRecordToOrg = new Map(
    (inspectionRecords ?? []).map((r) => [r.id, projectToOrg.get(r.project_id) ?? null])
  );
  const assignmentToOrg = new Map(
    (assignments ?? []).map((a) => [a.id, projectToOrg.get(a.project_id) ?? null])
  );

  function resolveJobOrgId(job: BackgroundJobWindowRow): string | null {
    switch (job.job_type) {
      case "render_itp_pdf":
        return itpToOrg.get((job.payload as RenderItpPdfPayload).itp_id) ?? null;
      case "render_inspection_report_pdf":
        return (
          inspectionRecordToOrg.get(
            (job.payload as RenderInspectionReportPdfPayload).inspection_record_id
          ) ?? null
        );
      case "render_fat_report_pdf":
        return assignmentToOrg.get((job.payload as RenderFatReportPdfPayload).assignment_id) ?? null;
      case "generate_monthly_report_pack":
        return (job.payload as MonthlyReportPackPayload).organization_id ?? null;
      case "render_portfolio_summary_pdf":
      default:
        return null; // portfolio-wide — no single organisation to attribute this to
    }
  }

  function durationSeconds(job: BackgroundJobWindowRow): number | null {
    if (job.status !== "completed" || !job.completed_at) return null;
    return (new Date(job.completed_at).getTime() - new Date(job.created_at).getTime()) / 1000;
  }

  // --- Aggregate per organisation ---
  const usageByOrg = new Map<string, OrgUsageRow>();
  function getOrgUsage(organizationId: string): OrgUsageRow {
    let row = usageByOrg.get(organizationId);
    if (!row) {
      row = {
        organizationId,
        organizationName: orgById.get(organizationId)?.name ?? "Unknown organisation",
        aiTotal: 0,
        aiByFeature: {},
        jobTotal: 0,
        jobCompletedDurations: [],
        jobByType: {},
      };
      usageByOrg.set(organizationId, row);
    }
    return row;
  }

  for (const row of aiRows ?? []) {
    const org = getOrgUsage(row.organization_id);
    org.aiTotal += 1;
    org.aiByFeature[row.feature] = (org.aiByFeature[row.feature] ?? 0) + 1;
  }

  let portfolioWideJobTotal = 0;
  const portfolioWideJobByType: Record<string, { count: number; completedDurations: number[] }> = {};

  for (const job of jobs) {
    const orgId = resolveJobOrgId(job);
    const duration = durationSeconds(job);
    const bucket = orgId ? getOrgUsage(orgId).jobByType : portfolioWideJobByType;
    const entry = bucket[job.job_type] ?? { count: 0, completedDurations: [] };
    entry.count += 1;
    if (duration !== null) entry.completedDurations.push(duration);
    bucket[job.job_type] = entry;

    if (orgId) {
      const org = getOrgUsage(orgId);
      org.jobTotal += 1;
      if (duration !== null) org.jobCompletedDurations.push(duration);
    } else {
      portfolioWideJobTotal += 1;
    }
  }

  const orgRows = [...usageByOrg.values()].sort(
    (a, b) => b.aiTotal + b.jobTotal - (a.aiTotal + a.jobTotal)
  );

  // --- Top-of-page summary ---
  const totalAiCalls = (aiRows ?? []).length;
  const totalRenderJobs = jobs.length;
  const totalCompletedDurations = jobs
    .map(durationSeconds)
    .filter((d): d is number => d !== null);
  const totalRenderSeconds = totalCompletedDurations.reduce((sum, d) => sum + d, 0);

  return (
    <div className="max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Usage &amp; Cost</h1>
        <p className="mt-1 text-sm text-muted">
          AI feature invocations and PDF render job volume per organisation, last {WINDOW_DAYS}{" "}
          days — a cost-visibility signal for the app&apos;s variable spend (Gemini AI tokens,
          Puppeteer render compute). Read-only reporting; no pricing or billing decisions are made
          here. Admin-only.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total AI calls" value={totalAiCalls} />
        <StatCard label="Total render jobs" value={totalRenderJobs} />
        <StatCard
          label="Total render time"
          value={formatDuration(totalRenderSeconds || null)}
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">Portfolio-wide jobs</h2>
        <p className="mt-1 text-sm text-muted">
          Job types with no single organisation to attribute to (e.g. the one-click portfolio
          summary PDF) — shown separately rather than force-fit to one org.
        </p>
        {portfolioWideJobTotal === 0 ? (
          <p className="mt-3 text-sm text-muted">None in this window.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(portfolioWideJobByType).map(([jobType, entry]) => (
              <li key={jobType} className="flex items-center justify-between">
                <span className="text-ink">{jobType}</span>
                <span className="text-muted">
                  {entry.count} job{entry.count === 1 ? "" : "s"} · avg{" "}
                  {formatDuration(averageSeconds(entry.completedDurations))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium text-ink">By organisation</h2>
        {orgRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No AI usage or render jobs in this window.</p>
        ) : (
          <div className="mt-3 divide-y divide-border">
            {orgRows.map((org) => (
              <div key={org.organizationId} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-ink">{org.organizationName}</h3>
                  <span className="text-sm text-muted">
                    {org.aiTotal} AI call{org.aiTotal === 1 ? "" : "s"} · {org.jobTotal} render
                    job{org.jobTotal === 1 ? "" : "s"} · avg{" "}
                    {formatDuration(averageSeconds(org.jobCompletedDurations))}
                  </span>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      AI invocations by feature
                    </p>
                    {org.aiTotal === 0 ? (
                      <p className="mt-1 text-sm text-muted">None</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {AI_FEATURES.filter((f) => org.aiByFeature[f]).map((feature) => (
                          <li key={feature} className="flex items-center justify-between">
                            <span className="text-ink">{feature}</span>
                            <span className="text-muted">{org.aiByFeature[feature]}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">
                      Render jobs by type
                    </p>
                    {org.jobTotal === 0 ? (
                      <p className="mt-1 text-sm text-muted">None</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5 text-sm">
                        {Object.entries(org.jobByType).map(([jobType, entry]) => (
                          <li key={jobType} className="flex items-center justify-between">
                            <span className="text-ink">{jobType}</span>
                            <span className="text-muted">
                              {entry.count} · avg {formatDuration(averageSeconds(entry.completedDurations))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
