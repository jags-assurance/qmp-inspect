import ExcelJS from "exceljs";

// R41 — AI offline round-trip: this module is the shared "column contract" between the export side
// (buildItpWorkbook, used by app/api/itps/[id]/export-xlsx/route.ts) and the re-upload side
// (parseItpWorkbook, used by lib/itps/offline-revision-actions.ts). Keeping both directions driven
// off the same header list/label maps is what makes the round trip actually round-trip: a workbook
// this module wrote is guaranteed to parse back into the exact same shape, and the parser is
// tolerant of a human having inserted/deleted rows or resaved the file (LibreOffice/Excel both
// rewrite styling on save) since it locates columns by header text rather than fixed cell addresses.

export const EVIDENCE_LABEL: Record<1 | 2 | 3, string> = {
  1: "Checklist",
  2: "Document upload",
  3: "Measurement record",
};

const EVIDENCE_LABEL_TO_CODE = new Map<string, 1 | 2 | 3>(
  (Object.entries(EVIDENCE_LABEL) as unknown as [string, string][]).map(([code, label]) => [
    label.toLowerCase(),
    Number(code) as 1 | 2 | 3,
  ])
);

/** Accepts the exact label, or a bare "1"/"2"/"3" for someone who typed the raw code back in. */
function parseEvidenceType(raw: string): 1 | 2 | 3 {
  const trimmed = raw.trim();
  const byLabel = EVIDENCE_LABEL_TO_CODE.get(trimmed.toLowerCase());
  if (byLabel) return byLabel;
  const asNumber = Number(trimmed);
  if (asNumber === 2 || asNumber === 3) return asNumber;
  return 1;
}

export const OFFLINE_WORKBOOK_HEADERS = [
  "Section Number",
  "Section Title",
  "Item Number",
  "Activity",
  "Acceptance Criteria",
  "Evidence Type",
  "Discipline",
] as const;

export interface OfflineWorkbookSourceItem {
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  evidenceType: 1 | 2 | 3;
  disciplineCode: string | null;
}

export interface OfflineWorkbookSourceSection {
  sectionNumber: number;
  title: string;
  items: OfflineWorkbookSourceItem[];
}

/** One activity row as parsed back out of a re-uploaded workbook. */
export interface OfflineParsedRow {
  sectionNumber: number;
  sectionTitle: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string;
  evidenceType: 1 | 2 | 3;
  disciplineCode: string | null;
}

export function buildItpWorkbook(itp: {
  itpNumber: string;
  title: string;
  revision: number;
}, sections: OfflineWorkbookSourceSection[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JAGS QMP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("ITP Activities", { views: [{ state: "frozen", ySplit: 3 }] });

  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = `${itp.itpNumber} — ${itp.title} (Rev ${itp.revision})`;
  sheet.getCell("A1").font = { bold: true, size: 12 };
  sheet.mergeCells("A2:G2");
  sheet.getCell("A2").value =
    "Edit the rows below, then re-upload this file on the ITP page to create a new revision. Add rows for new activities, delete rows to remove activities, or edit any cell to change it. Do not rename the column headers in row 3.";
  sheet.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF666666" } };
  sheet.getCell("A2").alignment = { wrapText: true };

  const headerRow = sheet.getRow(3);
  headerRow.values = [...OFFLINE_WORKBOOK_HEADERS];
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  });

  sheet.columns = [
    { width: 14 },
    { width: 28 },
    { width: 12 },
    { width: 40 },
    { width: 40 },
    { width: 18 },
    { width: 14 },
  ];

  let rowIndex = 4;
  for (const section of [...sections].sort((a, b) => a.sectionNumber - b.sectionNumber)) {
    for (const item of section.items) {
      sheet.getRow(rowIndex).values = [
        section.sectionNumber,
        section.title,
        item.itemNumber,
        item.activity,
        item.acceptanceCriteria ?? "",
        EVIDENCE_LABEL[item.evidenceType] ?? EVIDENCE_LABEL[1],
        item.disciplineCode ?? "",
      ];
      rowIndex += 1;
    }
  }

  return workbook;
}

export interface ParseItpWorkbookResult {
  error: string | null;
  rows: OfflineParsedRow[];
}

/**
 * Reads a re-uploaded workbook back into flat activity rows. Never trusts the file's shape blindly:
 * locates the header row by its text (tolerant of the two metadata rows above it being edited or
 * removed), and silently drops any data row missing an Item Number or Activity (same "required
 * fields" rule createItpFromDraftAction already applies to AI-drafted rows) rather than failing the
 * whole import over one blank row.
 */
export async function parseItpWorkbook(buffer: ArrayBuffer): Promise<ParseItpWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return { error: "Could not read this file — make sure it's the .xlsx workbook exported from this ITP.", rows: [] };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { error: "The workbook has no sheets to read.", rows: [] };
  }

  let headerRowNumber: number | null = null;
  let columnIndex: Record<(typeof OFFLINE_WORKBOOK_HEADERS)[number], number> | null = null;

  for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
    const row = sheet.getRow(r);
    const map: Partial<Record<(typeof OFFLINE_WORKBOOK_HEADERS)[number], number>> = {};
    row.eachCell((cell, colNumber) => {
      const text = String(cell.value ?? "").trim();
      const match = OFFLINE_WORKBOOK_HEADERS.find((h) => h.toLowerCase() === text.toLowerCase());
      if (match) map[match] = colNumber;
    });
    if (OFFLINE_WORKBOOK_HEADERS.every((h) => map[h] !== undefined)) {
      headerRowNumber = r;
      columnIndex = map as Record<(typeof OFFLINE_WORKBOOK_HEADERS)[number], number>;
      break;
    }
  }

  if (!headerRowNumber || !columnIndex) {
    return {
      error:
        "Could not find the expected column headers (Section Number, Section Title, Item Number, Activity, Acceptance Criteria, Evidence Type, Discipline) — please re-upload the file exported from this ITP without renaming its columns.",
      rows: [],
    };
  }

  const cellText = (row: ExcelJS.Row, col: number): string => {
    const value = row.getCell(col).value;
    if (value == null) return "";
    if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "").trim();
    if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "").trim();
    return String(value).trim();
  };

  const rows: OfflineParsedRow[] = [];
  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const itemNumber = cellText(row, columnIndex["Item Number"]);
    const activity = cellText(row, columnIndex["Activity"]);
    if (!itemNumber || !activity) continue;

    const sectionNumberRaw = cellText(row, columnIndex["Section Number"]);
    const sectionNumber = Number(sectionNumberRaw);
    const disciplineCode = cellText(row, columnIndex["Discipline"]);

    rows.push({
      sectionNumber: Number.isFinite(sectionNumber) && sectionNumber > 0 ? sectionNumber : rows.length + 1,
      sectionTitle: cellText(row, columnIndex["Section Title"]) || `Section ${sectionNumberRaw || rows.length + 1}`,
      itemNumber,
      activity,
      acceptanceCriteria: cellText(row, columnIndex["Acceptance Criteria"]),
      evidenceType: parseEvidenceType(cellText(row, columnIndex["Evidence Type"])),
      disciplineCode: disciplineCode || null,
    });
  }

  if (rows.length === 0) {
    return { error: "No activity rows were found in this file — make sure every row has at least an Item Number and Activity.", rows: [] };
  }

  return { error: null, rows };
}
