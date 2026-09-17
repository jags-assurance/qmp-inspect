import puppeteer from "puppeteer";
import { supabase } from "../supabase";
import { buildMonthlyReportHtml, type MonthlyReportTemplateData } from "./monthlyReportTemplate";
import { aggregateReportPackData } from "./reportPackAggregation";
import type { GenerateMonthlyReportPackPayload } from "./types";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

  const { startIso, endIso } = monthRange(year, month);
  const agg = await aggregateReportPackData(organizationId, startIso, endIso);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  const templateData: MonthlyReportTemplateData = {
    organizationName: agg.organizationName,
    year,
    month,
    monthLabel,
    firstTimePassRate: agg.firstTimePassRate,
    firstTimePassCounts: agg.firstTimePassCounts,
    inspectionsCompleted: agg.inspectionsCompleted,
    ncrsOpenedInMonth: agg.ncrsOpened,
    ncrsClosedInMonth: agg.ncrsClosed,
    ncrsBySeverity: agg.ncrsBySeverity,
    itpCompletionRate: agg.itpCompletionRate,
    itpCompletionCounts: agg.itpCompletionCounts,
    perProject: agg.perProject,
    generatedAt: new Date(),
  };

  const html = buildMonthlyReportHtml(templateData);
  const csv = buildCsv(templateData);

  // executablePath override is opt-in via env var only — Railway's deployment gets Puppeteer's own
  // downloaded Chrome (root package.json's pnpm.onlyBuiltDependencies lets its postinstall script
  // actually run; pnpm 10 silently skips it otherwise) plus the shared libraries Chrome needs to
  // launch on Linux at all (root nixpacks.toml's aptPkgs) and needs no override; this exists purely
  // so local dev on a machine without a working Puppeteer Chrome install can still exercise the
  // pipeline by pointing at a system Chrome/Chromium instead.
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    ...(process.env.PUPPETEER_EXECUTABLE_PATH ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH } : {}),
  });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Chrome doesn't reliably honor this template's `@page { margin: 15mm }` on its own — must pass
    // it explicitly so it matches the letterhead's -15mm full-bleed trick. See renderItpPdf.ts.
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
