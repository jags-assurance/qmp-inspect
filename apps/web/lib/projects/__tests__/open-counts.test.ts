import { describe, expect, it } from "vitest";
import { countOpenNcrs, countPunchByStatus, listHitCap, orgFilterOptionsFrom } from "../open-counts";

describe("countOpenNcrs", () => {
  it("splits observations from NCRs", () => {
    expect(countOpenNcrs([{ severity: "major_ncr" }, { severity: "observation" }, { severity: "minor_ncr" }, { severity: "observation" }])).toEqual({
      ncrs: 2,
      observations: 2,
      total: 4,
    });
  });
  it("handles an empty list", () => {
    expect(countOpenNcrs([])).toEqual({ ncrs: 0, observations: 0, total: 0 });
  });
});

describe("countPunchByStatus", () => {
  it("counts open, resolved and outstanding", () => {
    expect(countPunchByStatus([{ status: "open" }, { status: "resolved" }, { status: "open" }, { status: "in_progress" }])).toEqual({
      outstanding: 4,
      open: 2,
      resolved: 1,
    });
  });
});

describe("listHitCap", () => {
  it("is true only when the cap was reached", () => {
    expect(listHitCap(new Array(1000).fill(0), 1000)).toBe(true);
    expect(listHitCap(new Array(999).fill(0), 1000)).toBe(false);
    expect(listHitCap(null, 1000)).toBe(false);
  });
});

describe("orgFilterOptionsFrom", () => {
  it("dedupes by organisation, drops rows without one, and sorts by name", () => {
    const rows = [
      { organization_id: "b", organizations: { name: "Beta" } },
      { organization_id: "a", organizations: { name: "Alpha" } },
      { organization_id: "b", organizations: { name: "Beta" } },
      { organization_id: "c", organizations: null },
    ];
    expect(orgFilterOptionsFrom(rows)).toEqual([
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ]);
  });
});
