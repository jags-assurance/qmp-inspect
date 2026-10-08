import { fileOrgPackInProjectVaults, uploadGeneratedFile, buildGeneratedDirPath } from "./vaultAutoFile";
import { resolveProjectScope, packBasePath, packDocumentReference } from "./reportScope";
import { withBidi } from "./bidi";
import { getOrgBranding } from "./orgBranding";
import { getSharedBrowser } from "../browserPool";
import ExcelJS from "exceljs";
import { supabase } from "../supabase";
import { buildWeeklyReportHtml, type WeeklyReportTemplateData } from "./weeklyReportTemplate";
import { aggregateReportPackData } from "./reportPackAggregation";
import { stampUncontrolledCopyBanner } from "./xlsxUncontrolledCopy";
import type { GenerateWeeklyReportPackPayload } from "./types";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

function formatDateLabel(date: Date): string {
  // e.g. "15 Sep 2026" — matches the day/month-name/year convention MONTH_NAMES/monthLabel use in
  // generateMonthlyReportPack.ts, just at day granularity.
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  return `${day} ${month} ${date.getUTCFullYear()}`;
}

/** Parses a "YYYY-MM-DD" date string as a UTC midnight Date, and returns the 7-day
 *  [startIso, endIso) window beginning on that day — the weekly equivalent of monthRange() in
 *  generateMonthlyReportPack.ts. `weekStart` is validated by the caller (requestWeeklyReportPackAction
 *  in apps/web/lib/reports/actions.ts) but re-validated here defensively since the worker trusts
 *  nothing about a job payload's shape beyond its own type cast. */
function weekRange(weekStart: string): { startIso: string; endIso: string; startDate: Date; endDate: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart);
  if (!match) {
    throw new Error(`Invalid week_start "${weekStart}" — expected YYYY-MM-DD.`);
  }
  const [, y, m, d] = match;
  const start = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 0, 0, 0));
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid week_start "${weekStart}" — not a real calendar date.`);
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  // The last day actually covered by the pack is end - 1 day (the window itself is half-open).
  const lastDay = new Date(end);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  return { startIso: start.toISOString(), endIso: end.toISOString(), startDate: start, endDate: lastDay };
}

/**
 * Builds the real .xlsx workbook for the weekly report pack. Weekly sibling of buildXlsx in
 * generateMonthlyReportPack.ts — same columns the old CSV export carried, same three-sheet split,
 * and the same R107 "UNCONTROLLED COPY" banner (see that file's buildXlsx doc comment and
 * xlsxUncontrolledCopy.ts for the reasoning — a weekly pack is exactly as ad-hoc as a monthly one).
 */
async function buildXlsx(data: WeeklyReportTemplateData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JAGS QMP";
  workbook.created = data.generatedAt;

  const summarySheet = workbook.addWorksheet("Summary");
  stampUncontrolledCopyBanner(summarySheet, 2);
  summarySheet.addRow([`Weekly Report Pack — ${data.organizationName} — ${data.weekLabel}`]);
  summarySheet.addRow([]);
  summarySheet.addRow(["KPI", "Value"]).font = { bold: true };
  summarySheet.addRow(["First-Time Pass Rate %", data.firstTimePassRate ?? ""]);
  summarySheet.addRow(["First Attempts", data.firstTimePassCounts.firstAttempts]);
  summarySheet.addRow(["First-Time Passes", data.firstTimePassCounts.firstTimePasses]);
  summarySheet.addRow(["Inspections Completed", data.inspectionsCompleted]);
  summarySheet.addRow(["ITP Completion %", data.itpCompletionRate ?? ""]);
  summarySheet.addRow(["ITPs Client-Accepted", data.itpCompletionCounts.clientAccepted]);
  summarySheet.addRow(["ITPs Total", data.itpCompletionCounts.total]);
  summarySheet.addRow(["NCRs Opened This Week", data.ncrsOpenedInWeek]);
  summarySheet.addRow(["NCRs Closed This Week", data.ncrsClosedInWeek]);
  summarySheet.columns = [{ width: 28 }, { width: 20 }];

  const ncrSheet = workbook.addWorksheet("NCRs by Severity");
  stampUncontrolledCopyBanner(ncrSheet, 3);
  ncrSheet.addRow(["Severity", "Opened", "Closed"]).font = { bold: true };
  for (const row of data.ncrsBySeverity) {
    ncrSheet.addRow([row.severity, row.opened, row.closed]);
  }
  ncrSheet.columns = [{ width: 22 }, { width: 12 }, { width: 12 }];

  const projectSheet = workbook.addWorksheet("Per Project");
  stampUncontrolledCopyBanner(projectSheet, 5);
  projectSheet.addRow(["Project", "Project Number", "Inspections Completed", "NCRs Opened", "NCRs Closed"]).font = {
    bold: true,
  };
  for (const row of data.perProject) {
    projectSheet.addRow([row.projectName, row.projectNumber, row.inspectionsCompleted, row.ncrsOpened, row.ncrsClosed]);
  }
  projectSheet.columns = [{ width: 28 }, { width: 18 }, { width: 22 }, { width: 14 }, { width: 14 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Builds the weekly client report pack: one organisation, one 7-day window, aggregated across ALL
 * of that organisation's projects. The weekly sibling of generateMonthlyReportPack.ts (R109) —
 * same fetch -> template -> Puppeteer PDF -> Storage upload pattern, and the same fetch/aggregation
 * logic (shared via reportPackAggregation.ts), just scoped to a week instead of a calendar month.
 */
export async function generateWeeklyReportPack(
  payload: GenerateWeeklyReportPackPayload
): Promise<{ resultStoragePath: string }> {
  const { organization_id: organizationId, week_start: weekStart } = payload;
  const projectId = resolveProjectScope(payload.project_id);

  const { startIso, endIso, startDate, endDate } = weekRange(weekStart);
  const agg = await aggregateReportPackData(organizationId, startIso, endIso, projectId);

  const weekLabel = `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`;

  const templateData: WeeklyReportTemplateData = {
    organizationName: agg.organizationName,
    branding: await getOrgBranding(supabase, organizationId),
    weekStartIso: weekStart,
    weekEndIso: endDate.toISOString().slice(0, 10),
    weekLabel,
    firstTimePassRate: agg.firstTimePassRate,
    firstTimePassCounts: agg.firstTimePassCounts,
    inspectionsCompleted: agg.inspectionsCompleted,
    ncrsOpenedInWeek: agg.ncrsOpened,
    ncrsClosedInWeek: agg.ncrsClosed,
    ncrsBySeverity: agg.ncrsBySeverity,
    itpCompletionRate: agg.itpCompletionRate,
    itpCompletionCounts: agg.itpCompletionCounts,
    perProject: agg.perProject,
    generatedAt: new Date(),
  };

  const html = buildWeeklyReportHtml(templateData);
  const xlsxBuffer = await buildXlsx(templateData);

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdfBuffer: Buffer;
  try {
    await page.setContent(withBidi(html), { waitUntil: "networkidle0" });
    pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
      })
    );
  } finally {
    await page.close();
  }

  const basePath = packBasePath("weekly-reports", organizationId, weekStart, projectId);
  // Unique directory per generation; the file names stay fixed because the web app derives the
  // .xlsx path from the PDF path (xlsxPathFromPdfPath). Never overwrites an earlier generation.
  const pdfPath = buildGeneratedDirPath(basePath, "report-pack.pdf");
  const xlsxPath = pdfPath.replace(/report-pack\.pdf$/, "report-pack.xlsx");

  await uploadGeneratedFile(supabase, pdfPath, pdfBuffer);
  await uploadGeneratedFile(
    supabase,
    xlsxPath,
    xlsxBuffer as unknown as Buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  await fileOrgPackInProjectVaults(supabase, {
    projectIds: agg.perProject.map((p) => p.projectId),
    title: `Weekly Report Pack ${weekLabel}`,
    documentReference: packDocumentReference(`WEEKLY-${weekStart}`, projectId),
    storagePath: pdfPath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
  });

  // result_storage_path stores the PDF path, same convention as generateMonthlyReportPack.ts — the
  // web app derives the .xlsx path by convention (xlsxPathFromPdfPath) instead of a second DB column.
  return { resultStoragePath: pdfPath };
}
