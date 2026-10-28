import { describe, expect, it } from "vitest";
import { buildDataBookPdfHtml, type DataBookPdfData } from "../src/jobs/dataBookTemplate";

const cat = (label: string) => ({ key: label, label, total: 1, done: 1, percentage: 100, items: [] }) as never;

function sample(overrides: Partial<DataBookPdfData> = {}): DataBookPdfData {
  return {
    bookNumber: "T-DB-002",
    bookRevision: 1,
    title: "Test book",
    status: "draft",
    projectName: "Test project",
    projectNumber: "T-001",
    organizationName: "Test org",
    categories: [cat("ITPs approved")],
    handoverCertificate: cat("Handover certificate"),
    disciplineBreakdown: [],
    openPunchItems: 0,
    overallPercentage: 100,
    isReady: true,
    compiledAt: null,
    compiledBy: null,
    overrideReason: null,
    overrideBy: null,
    itps: [
      {
        itpNumber: "T-ITP-001",
        title: "Pump skid",
        revision: 0,
        status: "approved",
        phase: "Execution",
        standard: null,
        preparedBy: "A",
        reviewedBy: null,
        reviewedAt: null,
        approvedBy: "B",
        approvedAt: "2026-10-27",
        acceptedBy: null,
        acceptedAt: null,
        activities: [
          {
            itemNumber: "1.1",
            activity: "Foundation bolts",
            criteria: null,
            reference: null,
            method: null,
            interventions: [],
            recordNumber: "T-INSP-1",
            result: "pass",
            inspectionDate: "2026-10-27",
            inspector: "Ravi",
            irnNumber: "IRN-1",
            state: "Accepted",
            attempt: "B",
            earlierFailedCount: 1,
            reportUrl: null,
          },
        ],
      },
    ],
    siteLocation: null,
    parties: [{ name: "Client Co", partyType: "client" }],
    calibrations: [],
    welders: [],
    materials: [],
    ncrs: [],
    punchItems: [],
    earlierAttempts: [
      { itpNumber: "T-ITP-001", itemNumber: "1.1", activity: "Foundation bolts", attempt: "A", recordNumber: "T-INSP-0", inspectionDate: "2026-10-27", inspector: "Ravi", result: "fail", supersededByRecordNumber: "T-INSP-1" },
    ],
    generatedAt: new Date("2026-10-28T00:00:00Z"),
    ...overrides,
  } as DataBookPdfData;
}

describe("buildDataBookPdfHtml", () => {
  it("builds a draft revision book including the issue manifest", () => {
    const html = buildDataBookPdfHtml(sample());
    expect(html).toContain("Issue manifest and transmittal");
    expect(html).toContain("Revision");
  });
  it("builds with no records and no earlier attempts", () => {
    const html = buildDataBookPdfHtml(sample({ itps: [], earlierAttempts: [] }));
    expect(html).toContain("No records on this project.");
  });
});
