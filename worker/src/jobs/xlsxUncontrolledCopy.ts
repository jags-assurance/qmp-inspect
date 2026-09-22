import type ExcelJS from "exceljs";

/**
 * R107 "UNCONTROLLED COPY" watermark for .xlsx exports.
 *
 * The numbering engine (apps/web/lib/numbering) issues formally controlled documents — each one
 * gets a document number, a revision and (for ITPs) a signoff chain, and its PDF is the record of
 * that controlled state (see worker/src/jobs/renderItpPdf.ts). A report-pack workbook is not that:
 * it's an ad-hoc, regenerate-on-demand snapshot an admin can re-run for any month/week with no
 * revision history or approval chain, so it must never be mistaken for a controlled document if it
 * is printed or forwarded. Since there is no controlled/uncontrolled distinction inside a report
 * pack itself (the whole export is uncontrolled), every sheet gets this banner unconditionally.
 *
 * Merges a full-width row across `spanCols` columns, fills it red and puts bold white
 * "UNCONTROLLED COPY" text in it — the xlsx equivalent of a watermark, since native diagonal
 * watermarks aren't part of the OOXML feature set ExcelJS exposes.
 */
export function stampUncontrolledCopyBanner(sheet: ExcelJS.Worksheet, spanCols: number): void {
  const lastCol = String.fromCharCode("A".charCodeAt(0) + Math.max(spanCols, 1) - 1);
  sheet.mergeCells(`A1:${lastCol}1`);
  const cell = sheet.getCell("A1");
  cell.value = "UNCONTROLLED COPY — not a controlled document";
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC00000" } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 20;
}
