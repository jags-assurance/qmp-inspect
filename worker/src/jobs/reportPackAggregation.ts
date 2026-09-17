// Shared aggregation core for the client report packs (R109 monthly, and its weekly sibling) — one
// organisation, one date range [startIso, endIso), aggregated across ALL of that organisation's
// projects: first-time pass rate, inspections completed, NCR summary, and ITP completion %.
//
// Extracted out of generateMonthlyReportPack.ts so generateWeeklyReportPack.ts doesn't have to
// duplicate ~90 lines of identical Supabase queries/aggregation logic — both jobs only differ in
// how they compute the [startIso, endIso) window and how they label the period in their own
// template/CSV. The query/aggregation logic itself is generic over any date range, so it lives here
// once.
import { supabase } from "../supabase";
import type { MonthlyReportProjectRow } from "./monthlyReportTemplate";

export interface InspectionRecordRow {
  id: string;
  project_id: string;
  itp_item_id: string;
  overall_result: "pass" | "fail" | "partial" | null;
  created_at: string;
}

export interface NcrRow {
  id: string;
  project_id: string;
  severity: "observation" | "minor_ncr" | "major_ncr";
  status: string;
  created_at: string;
  closed_at: string | null;
}

export interface ReportPackAggregate {
  organizationName: string;
  firstTimePassRate: number | null;
  firstTimePassCounts: { firstAttempts: number; firstTimePasses: number };
  inspectionsCompleted: number;
  ncrsOpened: number;
  ncrsClosed: number;
  ncrsBySeverity: { severity: string; opened: number; closed: number }[];
  itpCompletionRate: number | null;
  itpCompletionCounts: { clientAccepted: number; total: number };
  perProject: MonthlyReportProjectRow[];
}

/**
 * Loads and aggregates one organisation's KPIs for the half-open date range [startIso, endIso),
 * across all of that organisation's projects. Used by both generateMonthlyReportPack.ts (a
 * calendar-month window) and generateWeeklyReportPack.ts (a 7-day window) — see each file's own
 * `monthRange`/`weekRange` helper for how they compute the window they pass in here.
 */
export async function aggregateReportPackData(
  organizationId: string,
  startIso: string,
  endIso: string
): Promise<ReportPackAggregate> {
  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .single();

  if (orgError || !organization) {
    throw new Error(`Organization ${organizationId} not found: ${orgError?.message ?? "no row"}`);
  }

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, project_number, name")
    .eq("organization_id", organizationId);

  if (projectsError) {
    throw new Error(`Failed to load projects for organization ${organizationId}: ${projectsError.message}`);
  }

  const projectRows = projects ?? [];
  const projectIds = projectRows.map((p) => p.id);

  // ITPs across the org's projects (all-time snapshot for completion %, per R109/compute.ts).
  const itpsResult =
    projectIds.length > 0
      ? await supabase.from("itps").select("id, project_id, status").in("project_id", projectIds).returns<
          { id: string; project_id: string; status: "draft" | "under_review" | "approved" | "client_accepted" }[]
        >()
      : { data: [] as { id: string; project_id: string; status: "draft" | "under_review" | "approved" | "client_accepted" }[], error: null };

  if (itpsResult.error) {
    throw new Error(`Failed to load ITPs: ${itpsResult.error.message}`);
  }
  const itps = itpsResult.data ?? [];

  // Inspection records for the period, across the org's projects — the same "overall_result is not
  // null = completed" logic as computeProjectKpis() in apps/web/lib/kpis/compute.ts, scoped to the
  // reporting period instead of a single project.
  const inspectionRecordsResult =
    projectIds.length > 0
      ? await supabase
          .from("inspection_records")
          .select("id, project_id, itp_item_id, overall_result, created_at")
          .in("project_id", projectIds)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("created_at", { ascending: true })
          .returns<InspectionRecordRow[]>()
      : { data: [] as InspectionRecordRow[], error: null };

  if (inspectionRecordsResult.error) {
    throw new Error(`Failed to load inspection records: ${inspectionRecordsResult.error.message}`);
  }
  const inspectionRecords = inspectionRecordsResult.data ?? [];

  // NCRs opened OR closed in the period, across the org's projects.
  const ncrsResult =
    projectIds.length > 0
      ? await supabase
          .from("ncrs")
          .select("id, project_id, severity, status, created_at, closed_at")
          .in("project_id", projectIds)
          .returns<NcrRow[]>()
      : { data: [] as NcrRow[], error: null };

  if (ncrsResult.error) {
    throw new Error(`Failed to load NCRs: ${ncrsResult.error.message}`);
  }
  const allNcrs = ncrsResult.data ?? [];
  const ncrsOpenedInPeriod = allNcrs.filter((n) => n.created_at >= startIso && n.created_at < endIso);
  const ncrsClosedInPeriod = allNcrs.filter((n) => n.closed_at && n.closed_at >= startIso && n.closed_at < endIso);

  // --- First-time pass rate, scoped to first attempts recorded within the period ---
  const firstAttemptByItem = new Map<string, InspectionRecordRow>();
  for (const record of inspectionRecords) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }
  const firstAttempts = [...firstAttemptByItem.values()].filter((r) => r.overall_result !== null);
  const firstTimePasses = firstAttempts.filter((r) => r.overall_result === "pass");
  const firstTimePassRate = firstAttempts.length > 0 ? (firstTimePasses.length / firstAttempts.length) * 100 : null;

  // --- ITP completion % (all-time snapshot, per file header note) ---
  const clientAcceptedCount = itps.filter((itp) => itp.status === "client_accepted").length;
  const itpCompletionRate = itps.length > 0 ? (clientAcceptedCount / itps.length) * 100 : null;

  // --- NCR summary by severity ---
  const severities: NcrRow["severity"][] = ["observation", "minor_ncr", "major_ncr"];
  const ncrsBySeverity = severities
    .map((severity) => ({
      severity,
      opened: ncrsOpenedInPeriod.filter((n) => n.severity === severity).length,
      closed: ncrsClosedInPeriod.filter((n) => n.severity === severity).length,
    }))
    .filter((row) => row.opened > 0 || row.closed > 0);

  // --- Per-project breakdown ---
  const perProject: MonthlyReportProjectRow[] = projectRows.map((project) => ({
    projectId: project.id,
    projectNumber: project.project_number,
    projectName: project.name,
    inspectionsCompleted: inspectionRecords.filter((r) => r.project_id === project.id && r.overall_result !== null).length,
    ncrsOpened: ncrsOpenedInPeriod.filter((n) => n.project_id === project.id).length,
    ncrsClosed: ncrsClosedInPeriod.filter((n) => n.project_id === project.id).length,
  }));

  return {
    organizationName: organization.name,
    firstTimePassRate,
    firstTimePassCounts: { firstAttempts: firstAttempts.length, firstTimePasses: firstTimePasses.length },
    inspectionsCompleted: inspectionRecords.filter((r) => r.overall_result !== null).length,
    ncrsOpened: ncrsOpenedInPeriod.length,
    ncrsClosed: ncrsClosedInPeriod.length,
    ncrsBySeverity,
    itpCompletionRate,
    itpCompletionCounts: { clientAccepted: clientAcceptedCount, total: itps.length },
    perProject,
  };
}
