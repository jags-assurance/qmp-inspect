import { describe, expect, it } from "vitest";
import { buildMonthlyTrends, buildPunchBySource, buildQualityByParty, sumOpenNcrs } from "../aggregates";

describe("buildMonthlyTrends", () => {
  const now = new Date(Date.UTC(2026, 5, 15)); // June 2026
  it("clips to project creation month and zero-fills", () => {
    const out = buildMonthlyTrends(
      [{ year: 2026, month0: 4, ncr_count: "2", inspection_count: 5 }, { year: 2025, month0: 0, ncr_count: 9, inspection_count: 9 }],
      "2026-04-20T00:00:00Z",
      now
    );
    expect(out.map((p) => p.label)).toEqual(["Apr 2026", "May 2026", "Jun 2026"]);
    expect(out.map((p) => p.ncrCount)).toEqual([0, 2, 0]);
    expect(out.map((p) => p.inspectionsCompletedCount)).toEqual([0, 5, 0]);
  });
  it("caps at six months for an old project", () => {
    expect(buildMonthlyTrends([], "2020-01-01T00:00:00Z", now)).toHaveLength(6);
  });
});

describe("buildPunchBySource", () => {
  it("labels and sorts by total desc", () => {
    const out = buildPunchBySource(
      [{ source: "manual", open_count: 1, closed_count: 0 }, { source: "ncr", open_count: "3", closed_count: "2" }, { source: "x", open_count: 0, closed_count: 0 }],
      { ncr: "NCR", manual: "Manual" }
    );
    expect(out.map((r) => r.label)).toEqual(["NCR", "Manual", "x"]);
    expect(out[0]).toMatchObject({ openCount: 3, closedCount: 2 });
  });
});

describe("buildQualityByParty", () => {
  it("rounds, nulls no-signoff parties, sorts", () => {
    const names = new Map([["a", "Alpha"], ["b", "Beta"]]);
    const out = buildQualityByParty(
      [
        { party_id: "b", signoff_total: 0, signoff_signed_off: 0, ncr_count: 2 },
        { party_id: "a", signoff_total: 3, signoff_signed_off: 2, ncr_count: 0 },
        { party_id: "z", signoff_total: 1, signoff_signed_off: 0, ncr_count: 0 },
      ],
      names
    );
    expect(out).toEqual([
      { partyName: "Alpha", percentage: 67, ncrCount: 0 },
      { partyName: "Unknown party", percentage: 0, ncrCount: 0 },
      { partyName: "Beta", percentage: null, ncrCount: 2 },
    ]);
  });
});

describe("sumOpenNcrs", () => {
  it("totals by project and org", () => {
    const r = sumOpenNcrs([
      { project_id: "p1", organization_id: "o1", open_count: "2" },
      { project_id: "p2", organization_id: "o1", open_count: 1 },
      { project_id: "p3", organization_id: null, open_count: 4 },
    ]);
    expect(r.total).toBe(7);
    expect(r.byOrg.get("o1")).toBe(3);
    expect(r.byProject.get("p3")).toBe(4);
  });
});
