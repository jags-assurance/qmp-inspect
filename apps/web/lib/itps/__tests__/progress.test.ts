import { describe, expect, it } from "vitest";
import { computeActivityProgress } from "../progress";

describe("computeActivityProgress", () => {
  it("is empty with no rows", () => {
    expect(computeActivityProgress([])).toEqual({ total: 0, complete: 0, outstanding: 0, percent: 0 });
  });

  it("counts an activity complete only when every party row is signed off", () => {
    const p = computeActivityProgress([
      { itp_item_id: "a", status: "signed_off" },
      { itp_item_id: "a", status: "signed_off" },
      { itp_item_id: "b", status: "signed_off" },
      { itp_item_id: "b", status: "pending" },
      { itp_item_id: "c", status: "pending" },
    ]);
    expect(p).toEqual({ total: 3, complete: 1, outstanding: 2, percent: 33 });
  });

  it("does not treat proceeded_no_response or rejected as signed off", () => {
    const p = computeActivityProgress([
      { itp_item_id: "a", status: "proceeded_no_response" },
      { itp_item_id: "b", status: "rejected" },
    ]);
    expect(p.complete).toBe(0);
    expect(p.outstanding).toBe(2);
  });

  it("is 100% when all activities are done", () => {
    const p = computeActivityProgress([{ itp_item_id: "a", status: "signed_off" }]);
    expect(p).toEqual({ total: 1, complete: 1, outstanding: 0, percent: 100 });
  });

  it("activity completion is not the share of party sign-offs (regression: the ITP header drew the party percentage under the activity label)", () => {
    const rows = [
      { itp_item_id: "a", status: "signed_off" },
      { itp_item_id: "a", status: "signed_off" },
      { itp_item_id: "b", status: "signed_off" },
      { itp_item_id: "b", status: "pending" },
    ];
    const p = computeActivityProgress(rows);
    expect(p).toMatchObject({ total: 2, complete: 1, outstanding: 1, percent: 50 });
    // Counting party sign-offs instead would give 3 of 4 = 75%.
    expect(Math.round((rows.filter((r) => r.status === "signed_off").length / rows.length) * 100)).toBe(75);
  });
});
