import { describe, it, expect } from "vitest";
import { buildInspectionReportHtml, type InspectionReportData } from "../src/jobs/inspectionReportTemplate";

const data: InspectionReportData = {
  recordNumber: "INS-001",
  revision: 0,
  activity: "Rebar check",
  projectName: "Proj",
  itpNumber: "ITP-1",
  location: "25.2048, 55.2708",
  inspectionDate: "2026-09-17",
  overallResult: "pass",
  discipline: "Civil",
  notes: null,
  narrative: null,
  results: [],
  photos: [],
  approvals: [],
  generatedAt: new Date("2026-09-18T00:00:00Z"),
};

describe("inspection report date", () => {
  it("prints the inspection date exactly once (Document Control ISSUE DATE)", () => {
    const html = buildInspectionReportHtml(data);
    expect(html.split("2026-09-17").length - 1).toBe(1);
    expect(html).toContain("<dt>ISSUE DATE</dt><dd>2026-09-17</dd>");
    expect(html).not.toContain("<th>Inspection date</th>");
  });
  it("still has one details table with the other rows", () => {
    const html = buildInspectionReportHtml(data);
    expect(html.match(/Inspection details/g)?.length).toBe(1);
    expect(html).toContain("<th>Project</th>");
  });
});
