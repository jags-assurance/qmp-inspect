import puppeteer from "puppeteer";
import { supabase } from "../supabase";
import { buildWeeklyReportHtml, type WeeklyReportTemplateData } from "./weeklyReportTemplate";
import { aggregateReportPackData } from "./reportPackAggregation";
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

function csvEscape(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsv(data: WeeklyReportTemplateData): string {
  const lines: string[] = [];
  lines.push(`Weekly Report Pack,${csvEscape(data.organizationName)},${csvEscape(data.weekLabel)}`);
  lines.push("");
  lines.push("KPI,Value");
  lines.push(`First-Time Pass Rate %,${data.firstTimePassRate ?? ""}`);
  lines.push(`First Attempts,${data.firstTimePassCounts.firstAttempts}`);
  lines.push(`First-Time Passes,${data.firstTimePassCounts.firstTimePasses}`);
  lines.push(`Inspections Completed,${data.inspectionsCompleted}`);
  lines.push(`ITP Completion %,${data.itpCompletionRate ?? ""}`);
  lines.push(`ITPs Client-Accepted,${data.itpCompletionCounts.clientAccepted}`);
  lines.push(`ITPs Total,${data.itpCompletionCounts.total}`);
  lines.push(`NCRs Opened This Week,${data.ncrsOpenedInWeek}`);
  lines.push(`NCRs Closed This Week,${data.ncrsClosedInWeek}`);
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
 * Builds the weekly client report pack: one organisation, one 7-day window, aggregated across ALL
 * of that organisation's projects. The weekly sibling of generateMonthlyReportPack.ts (R109) —
 * same fetch -> template -> Puppeteer PDF -> Storage upload pattern, and the same fetch/aggregation
 * logic (shared via reportPackAggregation.ts), just scoped to a week instead of a calendar month.
 * See that file's own header comment for the Excel-vs-CSV substitution note, which applies here
 * identically.
 */
export async function generateWeeklyReportPack(
  payload: GenerateWeeklyReportPackPayload
): Promise<{ resultStoragePath: string }> {
  const { organization_id: organizationId, week_start: weekStart } = payload;

  const { startIso, endIso, startDate, endDate } = weekRange(weekStart);
  const agg = await aggregateReportPackData(organizationId, startIso, endIso);

  const weekLabel = `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`;

  const templateData: WeeklyReportTemplateData = {
    organizationName: agg.organizationName,
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
  const csv = buildCsv(templateData);

  // Same executablePath override note as generateMonthlyReportPack.ts.
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
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
    await browser.close();
  }

  const basePath = `weekly-reports/${organizationId}/${weekStart}`;
  const pdfPath = `${basePath}/report-pack.pdf`;
  const csvPath = `${basePath}/report-pack.csv`;

  const { error: pdfUploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (pdfUploadError) {
    throw new Error(`Failed to upload weekly report PDF: ${pdfUploadError.message}`);
  }

  const { error: csvUploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(csvPath, Buffer.from(csv, "utf-8"), { contentType: "text/csv", upsert: true });

  if (csvUploadError) {
    throw new Error(`Failed to upload weekly report CSV: ${csvUploadError.message}`);
  }

  // result_storage_path stores the PDF path, same convention as generateMonthlyReportPack.ts — the
  // web app derives the CSV path by convention (csvPathFromPdfPath) instead of a second DB column.
  return { resultStoragePath: pdfPath };
}
