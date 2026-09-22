// R111 (4/4): the monthly report pack's AI executive summary.
//
// The worker (worker/src/jobs/generateMonthlyReportPack.ts) has NO AI provider access of its own —
// grep across worker/ for GEMINI_API_KEY/generateContent/anything resembling lib/ai/ turns up
// nothing; every existing AI feature in this codebase (ITP draft, NCR description, root-cause
// suggestion, report narrative, etc.) is a web-side server action that calls the shared provider
// abstraction in apps/web/lib/ai/. Adding a second, worker-side AI call path just for this one
// feature would duplicate the gate/audit-log/provider plumbing that already exists here, for no
// real benefit — the aggregated numbers a summary needs are cheap to recompute web-side too.
//
// So this stays web-side: an admin can generate the summary paragraph from the SAME real,
// already-computed numbers the report pack itself will show (see aggregateReportSummaryData below,
// which mirrors worker/src/jobs/reportPackAggregation.ts's first-time-pass-rate / ITP-completion /
// NCR-count logic against the web app's own Supabase client), review it, and it displays inline
// next to the "Generate monthly report pack" queue form — it is NOT embedded into the rendered
// PDF/xlsx (that would require passing pre-computed text into the background_jobs payload and
// having the worker splice it into the template, a bigger change than R111 asked for). This keeps
// the feature genuinely useful (real numbers, real prose) without reaching into the worker's
// rendering pipeline.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NCRS_TABLE } from "@/lib/ncrs/types";

export interface ReportSummaryAggregate {
  organizationName: string;
  projectCount: number;
  firstTimePassRate: number | null;
  inspectionsCompleted: number;
  ncrsOpened: number;
  ncrsClosed: number;
  itpCompletionRate: number | null;
}

/**
 * One organisation, one half-open date range [startIso, endIso) — mirrors
 * worker/src/jobs/reportPackAggregation.ts's aggregateReportPackData, trimmed to only the numbers
 * the executive-summary prompt actually needs (see lib/ai/provider.ts's SummarizeReportPackInput).
 */
export async function aggregateReportSummaryData(
  supabase: SupabaseClient,
  organizationId: string,
  startIso: string,
  endIso: string
): Promise<ReportSummaryAggregate> {
  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle<{ name: string }>();

  const { data: projects } = await supabase.from("projects").select("id").eq("organization_id", organizationId);
  const projectIds = (projects ?? []).map((p) => p.id as string);

  if (projectIds.length === 0) {
    return {
      organizationName: organization?.name ?? "",
      projectCount: 0,
      firstTimePassRate: null,
      inspectionsCompleted: 0,
      ncrsOpened: 0,
      ncrsClosed: 0,
      itpCompletionRate: null,
    };
  }

  const [{ data: itps }, { data: inspectionRecords }, { data: ncrs }] = await Promise.all([
    supabase.from("itps").select("id, status").in("project_id", projectIds).returns<{ id: string; status: string }[]>(),
    supabase
      .from("inspection_records")
      .select("itp_item_id, overall_result, created_at")
      .in("project_id", projectIds)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .returns<{ itp_item_id: string; overall_result: string | null; created_at: string }[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("created_at, closed_at")
      .in("project_id", projectIds)
      .returns<{ created_at: string; closed_at: string | null }[]>(),
  ]);

  const firstAttemptByItem = new Map<string, { overall_result: string | null }>();
  for (const record of inspectionRecords ?? []) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }
  const firstAttempts = [...firstAttemptByItem.values()].filter((r) => r.overall_result !== null);
  const firstTimePasses = firstAttempts.filter((r) => r.overall_result === "pass");
  const firstTimePassRate = firstAttempts.length > 0 ? Math.round((firstTimePasses.length / firstAttempts.length) * 1000) / 10 : null;

  const clientAcceptedCount = (itps ?? []).filter((itp) => itp.status === "client_accepted").length;
  const itpCompletionRate =
    (itps ?? []).length > 0 ? Math.round((clientAcceptedCount / (itps ?? []).length) * 1000) / 10 : null;

  const ncrsOpened = (ncrs ?? []).filter((n) => n.created_at >= startIso && n.created_at < endIso).length;
  const ncrsClosed = (ncrs ?? []).filter((n) => n.closed_at && n.closed_at >= startIso && n.closed_at < endIso).length;

  return {
    organizationName: organization?.name ?? "",
    projectCount: projectIds.length,
    firstTimePassRate,
    inspectionsCompleted: (inspectionRecords ?? []).filter((r) => r.overall_result !== null).length,
    ncrsOpened,
    ncrsClosed,
    itpCompletionRate,
  };
}
