import puppeteer from "puppeteer";
import ExcelJS from "exceljs";
import { supabase } from "../supabase";
import { buildMonthlyReportHtml, type MonthlyReportTemplateData } from "./monthlyReportTemplate";
import { aggregateReportPackData } from "./reportPackAggregation";
import { stampUncontrolledCopyBanner } from "./xlsxUncontrolledCopy";
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

/**
 * Builds the real .xlsx workbook for the monthly report pack (R107/R109). Same columns the old CSV
 * export carried — this only changes the output format, not the data — split across three sheets
 * (KPI summary / NCRs by severity / per-project breakdown) instead of one flat comma-joined table,
 * since a real workbook can hold more than one logical table without header rows colliding.
 *
 * R107 "UNCONTROLLED COPY" watermark: this report pack is an ad-hoc, on-demand export an admin can
 * regenerate at will for any month — it is not a formally issued, numbered document the way an ITP
 * PDF is (see renderItpPdf.ts: those carry a revision, prepared/reviewed/approved/client-accepted
 * signoffs and a controlled document number from the numbering engine). So every sheet gets a bold
 * red "UNCONTROLLED COPY" banner row up top via stampUncontrolledCopyBanner, marking it as an
 * informal snapshot rather than a controlled record.
 */
async function buildXlsx(data: MonthlyReportTemplateData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JAGS QMP";
  workbook.created = data.generatedAt;

  const summarySheet = workbook.addWorksheet("Summary");
  stampUncontrolledCopyBanner(summarySheet, 2);
  summarySheet.addRow([`Monthly Report Pack — ${data.organizationName} — ${data.monthLabel}`]);
  summarySheet.addRow([]);
  summarySheet.addRow(["KPI", "Value"]).font = { bold: true };
  summarySheet.addRow(["First-Time Pass Rate %", data.firstTimePassRate ?? ""]);
  summarySheet.addRow(["First Attempts", data.firstTimePassCounts.firstAttempts]);
  summarySheet.addRow(["First-Time Passes", data.firstTimePassCounts.firstTimePasses]);
  summarySheet.addRow(["Inspections Completed", data.inspectionsCompleted]);
  summarySheet.addRow(["ITP Completion %", data.itpCompletionRate ?? ""]);
  summarySheet.addRow(["ITPs Client-Accepted", data.itpCompletionCounts.clientAccepted]);
  summarySheet.addRow(["ITPs Total", data.itpCompletionCounts.total]);
  summarySheet.addRow(["NCRs Opened This Month", data.ncrsOpenedInMonth]);
  summarySheet.addRow(["NCRs Closed This Month", data.ncrsClosedInMonth]);
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
 * Builds the monthly client report pack (R109): one organisation, one calendar month, aggregated
 * across ALL of that organisation's projects. Follows the exact fetch -> template -> Puppeteer PDF
 * -> Storage upload pattern of renderItpPdf.ts, plus a real .xlsx Excel export (see buildXlsx above).
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
  const xlsxBuffer = await buildXlsx(templateData);

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
  const xlsxPath = `${basePath}/report-pack.xlsx`;

  const { error: pdfUploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (pdfUploadError) {
    throw new Error(`Failed to upload monthly report PDF: ${pdfUploadError.message}`);
  }

  const { error: xlsxUploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(xlsxPath, xlsxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  if (xlsxUploadError) {
    throw new Error(`Failed to upload monthly report Excel workbook: ${xlsxUploadError.message}`);
  }

  // result_storage_path stores the PDF path (the primary deliverable, same convention as
  // render_itp_pdf). The .xlsx lives alongside it at the same base path — see basePath above — so
  // the web app derives its path by convention rather than needing a second DB column.
  return { resultStoragePath: pdfPath };
}
