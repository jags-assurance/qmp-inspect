// R107 — Word (.docx) export of a controlled ITP document, using the `docx` npm package. Same
// "small dedicated builder module, called directly by the route handler" pattern this codebase
// already uses for .xlsx (lib/itps/offline-workbook.ts, lib/checklist-library/xlsx.ts) — kept
// separate from the route so it stays a plain, testable function.
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export interface ItpDocxItem {
  id: string;
  itemNumber: string;
  activity: string;
  acceptanceCriteria: string | null;
  method: string | null;
  frequency: string | null;
}

export interface ItpDocxSection {
  sectionNumber: number;
  title: string;
  items: ItpDocxItem[];
}

export interface ItpDocxParty {
  id: string;
  name: string;
}

export interface ItpDocxInterventionCell {
  itpItemId: string;
  projectPartyId: string;
  /** The intervention level's code (e.g. "H"/"W"/"R"/"S", or a custom org-configured code). */
  intervention: string;
}

export interface ItpDocxData {
  itpNumber: string;
  title: string;
  statusLabel: string;
  revision: number;
  sections: ItpDocxSection[];
  parties: ItpDocxParty[];
  interventions: ItpDocxInterventionCell[];
}

const CELL_MARGIN = { top: 80, bottom: 80, left: 100, right: 100 };

function headerCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: "EFEFEF" },
    margins: CELL_MARGIN,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
}

function bodyCell(text: string, widthPct: number): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    margins: CELL_MARGIN,
    children: [new Paragraph({ children: [new TextRun({ text })] })],
  });
}

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
};

/**
 * Builds the controlled ITP document as a real .docx — ITP identity, each section's activities
 * (item number/activity/acceptance criteria/method & frequency, the same fields the PDF and .xlsx
 * exports already cover — see worker/src/jobs/itpTemplate.ts), and a plain per-party intervention
 * grid (party names as columns, the same H/W/R/S-or-custom codes activity-signoff-grid.tsx renders
 * in the web app). Deliberately simpler than the HTML grid's sign-off styling/notice-period detail —
 * a plain table of codes is enough for an offline Word copy.
 */
export async function buildItpDocx(data: ItpDocxData): Promise<Buffer> {
  const interventionByKey = new Map(
    data.interventions.map((row) => [`${row.itpItemId}:${row.projectPartyId}`, row.intervention])
  );

  const bannerParagraph = new Paragraph({
    shading: { type: ShadingType.CLEAR, fill: "C00000" },
    alignment: AlignmentType.CENTER,
    spacing: { before: 100, after: 200 },
    children: [
      new TextRun({
        text: "UNCONTROLLED COPY — not a controlled document",
        bold: true,
        color: "FFFFFF",
        size: 24,
      }),
    ],
  });

  const titleParagraph = new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: `${data.itpNumber} — ${data.title}` })],
  });

  const metaParagraph = new Paragraph({
    spacing: { after: 300 },
    children: [
      new TextRun({ text: `Status: ${data.statusLabel}  ·  Revision: ${data.revision}`, italics: true }),
    ],
  });

  const sectionBlocks = data.sections.flatMap((section) => {
    const heading = new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
      children: [new TextRun({ text: `${section.sectionNumber}. ${section.title}` })],
    });

    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell("Item #", 10),
        headerCell("Activity", 30),
        headerCell("Acceptance Criteria", 35),
        headerCell("Method / Frequency", 25),
      ],
    });

    const dataRows = section.items.map(
      (item) =>
        new TableRow({
          children: [
            bodyCell(item.itemNumber, 10),
            bodyCell(item.activity, 30),
            bodyCell(item.acceptanceCriteria ?? "", 35),
            bodyCell([item.method, item.frequency].filter(Boolean).join(" / ") || "", 25),
          ],
        })
    );

    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [headerRow, ...dataRows],
    });

    return [heading, table];
  });

  const allItems = data.sections.flatMap((s) => s.items);
  const interventionBlocks: (Paragraph | Table)[] =
    allItems.length > 0 && data.parties.length > 0
      ? [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
            children: [new TextRun({ text: "Intervention Grid" })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: TABLE_BORDERS,
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  headerCell("Item #", 100 / (data.parties.length + 1)),
                  ...data.parties.map((party) => headerCell(party.name, 100 / (data.parties.length + 1))),
                ],
              }),
              ...allItems.map(
                (item) =>
                  new TableRow({
                    children: [
                      bodyCell(item.itemNumber, 100 / (data.parties.length + 1)),
                      ...data.parties.map((party) =>
                        bodyCell(
                          interventionByKey.get(`${item.id}:${party.id}`) ?? "",
                          100 / (data.parties.length + 1)
                        )
                      ),
                    ],
                  })
              ),
            ],
          }),
        ]
      : [];

  const doc = new Document({
    creator: "JAGS QMP",
    sections: [
      {
        children: [bannerParagraph, titleParagraph, metaParagraph, ...sectionBlocks, ...interventionBlocks],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
