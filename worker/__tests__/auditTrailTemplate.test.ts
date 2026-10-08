import { describe, expect, it } from "vitest";
import { buildAuditTrailPdfHtml, escapeHtml, formatUtc, humanize } from "../src/jobs/auditTrailTemplate";

const base = {
  projectName: "P-001 · Tower",
  organizationName: "Acme",
  filterDescription: "all recorded events",
  rows: [
    { createdAt: "2026-03-04T05:06:07.000Z", actorName: "Ada <b>", actorEmail: "ada@x.test", entityType: "ncr", action: "closed_out", summary: '<script>alert("x")</script>' },
    { createdAt: "2026-03-03T00:00:00.000Z", actorName: null, actorEmail: null, entityType: "itp", action: "approved", summary: "ok" },
  ],
  truncated: false,
  rowCap: 5000,
  exportedByName: "Staff One",
  generatedAt: new Date("2026-06-01T10:00:00.000Z"),
};

describe("buildAuditTrailPdfHtml", () => {
  it("escapes every user-controlled value", () => {
    const html = buildAuditTrailPdfHtml(base);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Ada &lt;b&gt;");
  });
  it("lists rows in UTC with humanized labels and System for no actor", () => {
    const html = buildAuditTrailPdfHtml(base);
    expect(html).toContain("2026-03-04 05:06:07");
    expect(html).toContain("Closed out");
    expect(html).toContain(">System<");
    expect(html).toContain("2 events listed");
  });
  it("states the cap loudly when truncated and not otherwise", () => {
    expect(buildAuditTrailPdfHtml({ ...base, truncated: true })).toContain("Incomplete listing");
    expect(buildAuditTrailPdfHtml(base)).not.toContain("Incomplete listing");
  });
  it("renders an explicit empty state", () => {
    expect(buildAuditTrailPdfHtml({ ...base, rows: [] })).toContain("No audit events match");
  });
  it("helpers", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(humanize("a_b")).toBe("A b");
    expect(formatUtc("nope")).toBe("nope");
  });
});
