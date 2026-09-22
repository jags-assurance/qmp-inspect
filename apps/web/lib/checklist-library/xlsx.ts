// Real .xlsx generation/parsing for checklist library templates (R47), using exceljs — the same
// library already used server-side for report-pack workbooks (worker/src/jobs/generate*ReportPack.ts).
// Kept as its own module, separate from the "use server" actions file, since ExcelJS.Buffer/Workbook
// values aren't valid Server Action return types (they're not plain serialisable data), so the
// route handler and the parsing action each call these plain functions directly instead.
import ExcelJS from "exceljs";
import { CHECKLIST_TEMPLATE_XLSX_COLUMNS, type ChecklistLibraryItemRow, type ParsedLibraryItemRow } from "./types";

/** Builds the downloadable .xlsx for a library template's current items — item number, description,
 *  acceptance criteria, evidence type, mandatory — in the exact column order re-upload expects. */
export async function buildLibraryTemplateWorkbook(title: string, items: ChecklistLibraryItemRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JAGS QMP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Checklist Template");
  sheet.addRow([title]).font = { bold: true, size: 13 };
  sheet.addRow([]);
  const headerRow = sheet.addRow([...CHECKLIST_TEMPLATE_XLSX_COLUMNS]);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E5E5" } };
  });

  for (const item of [...items].sort((a, b) => a.sort_order - b.sort_order)) {
    sheet.addRow([
      item.item_number,
      item.description,
      item.acceptance_criteria ?? "",
      item.evidence_type ?? "",
      item.is_mandatory ? "Yes" : "No",
    ]);
  }

  sheet.columns = [{ width: 14 }, { width: 44 }, { width: 44 }, { width: 18 }, { width: 12 }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Parses an uploaded .xlsx matching the export's column layout into review-ready rows — nothing is
 * written to the database here (see commitLibraryImportAction in actions.ts for that). Header/title
 * rows are located by matching the first cell against "Item Number" (case-insensitive), so this
 * tolerates the title+blank-row preamble the export itself writes, or a plain header-only sheet a
 * user built by hand. Every data row below the header is returned, even a malformed one — a missing
 * item number or description is flagged in validationError rather than silently skipped, per R47's
 * "surface it clearly, don't silently skip or crash" requirement.
 */
export async function parseLibraryItemsWorkbook(buffer: ArrayBuffer): Promise<{ rows: ParsedLibraryItemRow[]; error: string | null }> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs's own bundled @types/node resolves to a different (newer) Buffer shape than this
    // package's — a monorepo hoisting mismatch, not a real type error; Node's Buffer.from() below
    // still produces a real, correct Buffer at runtime either way.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
    await workbook.xlsx.load(Buffer.from(buffer) as any);
  } catch {
    return { rows: [], error: "Could not read that file — make sure it's a valid .xlsx workbook." };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], error: "The workbook has no sheets." };
  }

  let headerRowNumber = -1;
  sheet.eachRow((row, rowNumber) => {
    if (headerRowNumber !== -1) return;
    const firstCell = String(row.getCell(1).value ?? "").trim().toLowerCase();
    if (firstCell === "item number") headerRowNumber = rowNumber;
  });

  if (headerRowNumber === -1) {
    return {
      rows: [],
      error: 'Could not find a header row starting with "Item Number" — download the template to see the expected layout.',
    };
  }

  const rows: ParsedLibraryItemRow[] = [];
  const seenItemNumbers = new Set<string>();
  for (let rowNumber = headerRowNumber + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    const cellText = (col: number) => {
      const value = row.getCell(col).value;
      if (value === null || value === undefined) return "";
      if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "").trim();
      return String(value).trim();
    };

    const item_number = cellText(1);
    const description = cellText(2);
    const acceptance_criteria = cellText(3);
    const evidence_type = cellText(4);
    const mandatoryText = cellText(5).toLowerCase();

    // A completely blank row (common at the end of a sheet) is skipped outright rather than
    // reported as an error — it carries no data to validate or reject.
    if (!item_number && !description && !acceptance_criteria && !evidence_type && !mandatoryText) continue;

    let validationError: string | null = null;
    if (!item_number) validationError = "Missing item number.";
    else if (!description) validationError = "Missing description.";
    else if (seenItemNumbers.has(item_number)) validationError = `Duplicate item number "${item_number}" in this file.`;

    if (item_number && !validationError) seenItemNumbers.add(item_number);

    rows.push({
      item_number,
      description,
      acceptance_criteria,
      evidence_type,
      is_mandatory: mandatoryText !== "no" && mandatoryText !== "false" && mandatoryText !== "0",
      validationError,
    });
  }

  if (rows.length === 0) {
    return { rows: [], error: "No data rows found below the header." };
  }

  return { rows, error: null };
}
