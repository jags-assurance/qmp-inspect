import puppeteer from "puppeteer";
import { supabase } from "../supabase";
import { buildMonthlyReportHtml, type MonthlyReportProjectRow, type MonthlyReportTemplateData } from "./monthlyReportTemplate";
import type { GenerateMonthlyReportPackPayload } from "./types";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface InspectionRecordRow {
  id: string;
  project_id: string;
  itp_item_id: string;
  overall_result: "pass" | "fail" | "partial" | null;
  created_at: string;
}

interface NcrRow {
  id: string;
  project_id: string;
  severity: "observation" | "minor_ncr" | "major_ncr";
  status: string;
  created_at: string;
  closed_at: string | null;
}

function monthRange(year: number, month: number): { startIso: string; endIso: string } {
  // month is 1-12. Both bounds in UTC, [start, end).
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 0, 0, 0));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsv(data: MonthlyReportTemplateData): string {
  const lines: string[] = [];
  lines.push(`Monthly Report Pack,${csvEscape(data.organizationName)},${csvEscape(data.monthLabel)}`);
  lines.push("");
  lines.push("KPI,Value");
  lines.push(`First-Time Pass Rate %,${data.firstTimePassRate ?? ""}`);
  lines.push(`First Attempts,${data.firstTimePassCounts.firstAttempts}`);
  lines.push(`First-Time Passes,${data.firstTimePassCounts.firstTimePasses}`);
  lines.push(`Inspections Completed,${data.inspectionsCompleted}`);
  lines.push(`ITP Completion %,${data.itpCompletionRate ?? ""}`);
  lines.push(`ITPs Client-Accepted,${data.itpCompletionCounts.clientAccepted}`);
  lines.push(`ITPs Total,${data.itpCompletionCounts.total}`);
  lines.push(`NCRs Opened This Month,${data.ncrsOpenedInMonth}`);
  lines.push(`NCRs Closed This Month,${data.ncrsClosedInMonth}`);
  lines.push("");
  lines.push("NCR Summary by Severity,Opened,Closed");
  for (const row of data.ncrsBySeverity) {
    lines.push(`${csvEscape(row.severity)},${row.opened},${row.closed}`);
  }
  lines.push("");
  lines.push("Project,Project Number,Inspections Completed,NCRs Opened,NCRs Closed");
  for (const row of data.perProject) {
    lines.push(
      `${csvEscape(row.projectName)},${csvEscape(row.projectNumber)},${row.inspectionsCompleted},${row.ncrsOpened},${row.ncrsClosed}`
    );
  }
  return lines.join("\n");
}

/**
 * Builds the monthly client report pack (R109): one organisation, one calendar month, aggregated
 * across ALL of that organisation's projects. Follows the exact fetch -> template -> Puppeteer PDF
 * -> Storage upload pattern of renderItpPdf.ts, plus a CSV export.
 *
 * Excel note: neither `xlsx` nor `exceljs` is present anywhere in this monorepo's package.json
 * files (checked worker/, apps/web/, packages/shared-types/, and the workspace root) and adding a
 * new heavy dependency for one job type isn't warranted, so the "Excel" half of the pack (R109) is
 * substituted with a plain CSV export instead — it opens directly in Excel and carries the same
 * data, just without native .xlsx formatting/formulas. This substitution is called out again in the
 * app-facing generate-report-pack server action's UI copy.
 */
export async function generateMonthlyReportPack(
  payload: GenerateMonthlyReportPackPayload
): Promise<{ resultStoragePath: string }> {
  const { organization_id: organizationId, year, month } = payload;

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

  const { startIso, endIso } = monthRange(year, month);

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

  // Inspection records for the month, across the org's projects — the same "overall_result is not
  // null = completed" logic as computeProjectKpis() in apps/web/lib/kpis/compute.ts, scoped to the
  // reporting month instead of a single project.
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

  // NCRs opened OR closed in the month, across the org's projects.
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
  const ncrsOpenedInMonth = allNcrs.filter((n) => n.created_at >= startIso && n.created_at < endIso);
  const ncrsClosedInMonth = allNcrs.filter((n) => n.closed_at && n.closed_at >= startIso && n.closed_at < endIso);

  // --- First-time pass rate, scoped to first attempts recorded within the month ---
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
      opened: ncrsOpenedInMonth.filter((n) => n.severity === severity).length,
      closed: ncrsClosedInMonth.filter((n) => n.severity === severity).length,
    }))
    .filter((row) => row.opened > 0 || row.closed > 0);

  // --- Per-project breakdown ---
  const perProject: MonthlyReportProjectRow[] = projectRows.map((project) => ({
    projectId: project.id,
    projectNumber: project.project_number,
    projectName: project.name,
    inspectionsCompleted: inspectionRecords.filter((r) => r.project_id === project.id && r.overall_result !== null).length,
    ncrsOpened: ncrsOpenedInMonth.filter((n) => n.project_id === project.id).length,
    ncrsClosed: ncrsClosedInMonth.filter((n) => n.project_id === project.id).length,
  }));

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  const templateData: MonthlyReportTemplateData = {
    organizationName: organization.name,
    year,
    month,
    monthLabel,
    firstTimePassRate,
    firstTimePassCounts: { firstAttempts: firstAttempts.length, firstTimePasses: firstTimePasses.length },
    inspectionsCompleted: inspectionRecords.filter((r) => r.overall_result !== null).length,
    ncrsOpenedInMonth: ncrsOpenedInMonth.length,
    ncrsClosedInMonth: ncrsClosedInMonth.length,
    ncrsBySeverity,
    itpCompletionRate,
    itpCompletionCounts: { clientAccepted: clientAcceptedCount, total: itps.length },
    perProject,
    generatedAt: new Date(),
  };

  const html = buildMonthlyReportHtml(templateData);
  const csv = buildCsv(templateData);

  // executablePath override is opt-in via env var only — Railway's real deployment installs
  // Chromium via its own buildpack and needs no override; this exists purely so local dev on a
  // machine without Puppeteer's bundled Chromium (e.g. this one) can still exercise the pipeline.
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = Buffer.from(await page.pdf({ format: "A4", landscape: false, printBackground: true }));
  } finally {
    await browser.close();
  }

  const monthTag = String(month).padStart(2, "0");
  const basePath = `monthly-reports/${organizationId}/${year}-${monthTag}`;
  const pdfPath = `${basePath}/report-pack.pdf`;
  const csvPath = `${basePath}/report-pack.csv`;

  const { error: pdfUploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (pdfUploadError) {
    throw new Error(`Failed to upload monthly report PDF: ${pdfUploadError.message}`);
  }

  const { error: csvUploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(csvPath, Buffer.from(csv, "utf-8"), { contentType: "text/csv", upsert: true });

  if (csvUploadError) {
    throw new Error(`Failed to upload monthly report CSV: ${csvUploadError.message}`);
  }

  // result_storage_path stores the PDF path (the primary deliverable, same convention as
  // render_itp_pdf). The CSV lives alongside it at the same base path — see basePath above — so the
  // web app derives the CSV's path by convention rather than needing a second DB column.
  return { resultStoragePath: pdfPath };
}
