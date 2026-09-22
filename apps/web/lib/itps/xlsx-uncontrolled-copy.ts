import type ExcelJS from "exceljs";

/**
 * R107 "UNCONTROLLED COPY" watermark for .xlsx exports of a controlled ITP document.
 *
 * This is a deliberate, small duplicate of worker/src/jobs/xlsxUncontrolledCopy.ts — that helper
 * lives in the worker package (used by the report-pack workbooks it renders) and this route runs in
 * apps/web, a separate package with no shared runtime lib between the two (see this app's own
 * AGENTS.md and the existing precedent of small duplicated helpers, e.g. PARTY_TYPE_LABEL kept in
 * sync by hand between worker/src/jobs/itpTemplate.ts and the web app, rather than a new shared
 * package for ~15 lines). Keep both copies' visual output identical if either changes.
 *
 * Unlike a report-pack workbook (which is uncontrolled by nature), the ITP itself IS a controlled
 * document — its PDF is the record of that controlled state (worker/src/jobs/renderItpPdf.ts). This
 * .xlsx is a downloadable working copy of that same content (for offline editing, or now for a plain
 * Word export), so it must carry the same "this is not the controlled record" banner a printed/
 * forwarded copy of it would need.
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
