import { describe, it, expect } from "vitest";
import {
  daysUntil,
  calibrationStatus,
  welderStatus,
  personnelStatus,
  calibrationLabel,
  qualificationLabel,
  fmtDmy,
} from "../src/jobs/registerStatus";
import * as webStatus from "../../apps/web/lib/registers/status";
import { buildNcrApprovalBoxes, formatApprovalDate, renderNcrApprovalsHtml } from "../src/jobs/ncrApprovals";
import { formatLocation } from "../src/jobs/inspectionReportTemplate";

const TODAY = new Date(Date.UTC(2026, 5, 15));
const plus = (n: number) => new Date(TODAY.getTime() + n * 86_400_000).toISOString().slice(0, 10);

describe("worker registerStatus", () => {
  it("windows match the web implementation exactly (drift guard)", () => {
    for (let d = -3; d <= 95; d++) {
      const s = plus(d);
      expect(daysUntil(s, TODAY)).toBe(webStatus.daysUntil(s, TODAY));
      const c = calibrationStatus(s, TODAY);
      expect(c === "soon" ? "due_soon" : c).toBe(webStatus.computeCalibrationStatus(s, TODAY));
      const w = welderStatus(s, TODAY);
      expect(w === "soon" ? "expiring" : w).toBe(webStatus.computeWelderStatus(s, TODAY));
      const p = personnelStatus(s, TODAY);
      expect(p === "soon" ? "expiring_soon" : p).toBe(webStatus.computePersonnelCertificationStatus(s, TODAY));
    }
  });
  it("boundaries", () => {
    expect(calibrationStatus(plus(30), TODAY)).toBe("soon");
    expect(calibrationStatus(plus(31), TODAY)).toBe("valid");
    expect(calibrationStatus(plus(-1), TODAY)).toBe("expired");
    expect(welderStatus(plus(90), TODAY)).toBe("soon");
    expect(welderStatus(plus(91), TODAY)).toBe("valid");
  });
  it("labels", () => {
    expect(calibrationLabel("expired")).toBe("Calibration expired");
    expect(calibrationLabel("soon")).toBe("Due within 30 days");
    expect(calibrationLabel("valid")).toBe("In calibration");
    expect(qualificationLabel("soon")).toBe("Expiring within 90 days");
    expect(qualificationLabel("valid")).toBe("Qualified");
  });
  it("fmtDmy", () => {
    expect(fmtDmy(null)).toBe("—");
    expect(fmtDmy("2026-06-05")).toBe("05-06-2026");
    expect(fmtDmy("2026-06-05T23:00:00Z")).toBe("05-06-2026");
    expect(fmtDmy("garbage")).toBe("garbage");
  });
});

describe("worker ncrApprovals", () => {
  const parties = [
    { id: "1", party_type: "client", name: "Client Co", user_id: "uc" },
    { id: "2", party_type: "subcontractor", name: "Sub A", user_id: "us1" },
    { id: "3", party_type: "subcontractor", name: "Sub B", user_id: null },
    { id: "4", party_type: "jags", name: "JAGS", user_id: "uj" },
  ];
  it("formatApprovalDate", () => {
    expect(formatApprovalDate(null)).toBeNull();
    expect(formatApprovalDate("2026-06-05T10:00:00Z")).toBe("2026-06-05");
    expect(formatApprovalDate("nonsense")).toBe("nonsense");
  });
  it("always has a JAGS box first; only parties present get boxes, in fixed order", () => {
    const boxes = buildNcrApprovalBoxes(parties, [], "JAGS Ltd");
    expect(boxes.map((b) => b.label)).toEqual(["JAGS field engineer / raiser", "Client representative", "Subcontractor"]);
    expect(boxes[0].organisation).toBe("JAGS Ltd");
    expect(boxes[2].organisation).toBe("Sub A / Sub B");
    expect(boxes.every((b) => b.name === null && b.date === null)).toBe(true);
  });
  it("fills boxes from actions by party user, JAGS by jags user", () => {
    const boxes = buildNcrApprovalBoxes(
      parties,
      [
        { userId: "uj", userName: "Ina", action: "Raised by", date: "2026-06-01T00:00:00Z" },
        { userId: "uc", userName: "Cal", action: "Closed by", date: "2026-06-09" },
      ],
      null
    );
    expect(boxes[0]).toMatchObject({ name: "Ina", action: "Raised by", date: "2026-06-01" });
    expect(boxes[1]).toMatchObject({ name: "Cal", action: "Closed by", date: "2026-06-09" });
    expect(boxes[2].name).toBeNull();
  });
  it("an action by an unknown user falls to the JAGS box, but is not reused by a party", () => {
    const boxes = buildNcrApprovalBoxes(parties, [{ userId: "zzz", userName: "Zed", action: "Raised by", date: null }], null);
    expect(boxes[0].name).toBe("Zed");
    expect(boxes[0].date).toBeNull();
  });
  it("html escapes user content", () => {
    const html = renderNcrApprovalsHtml([
      { label: "L", organisation: "<b>Org</b>", action: "A&B", name: "O'Neil \"x\"", date: null },
    ]);
    expect(html).not.toContain("<b>Org</b>");
    expect(html).toContain("&lt;b&gt;Org&lt;/b&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("O&#39;Neil &quot;x&quot;");
    expect(html).toContain("____________");
  });
});

describe("worker inspection formatLocation", () => {
  it("null/empty", () => {
    expect(formatLocation(null)).toBeNull();
    expect(formatLocation("")).toBeNull();
  });
  it("coordinates and last-pair behaviour", () => {
    expect(formatLocation("12.971599, 77.594566")).toBe("Lat 12.971599, Long 77.594566");
    expect(formatLocation("Plot 1.5, 2.5 (13.0, 80.25)")).toBe("Lat 13.0, Long 80.25");
  });
  it("preset name unchanged", () => {
    expect(formatLocation("Tank Farm")).toBe("Tank Farm");
  });
});
