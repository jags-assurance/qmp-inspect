import { describe, expect, it } from "vitest";
import { describeCloseBlockers, isClosedStatus, statusReasonError } from "../close-helpers";

describe("describeCloseBlockers", () => {
  it("lists only non-zero counts with correct plurals", () => {
    expect(describeCloseBlockers({ openNcrs: 1, openPunch: 3, overdueHolds: 0, draftInspections: 2 })).toEqual([
      "1 open NCR",
      "3 open punch items",
      "2 draft inspections",
    ]);
    expect(describeCloseBlockers({ openNcrs: 0, openPunch: 0, overdueHolds: 0, draftInspections: 0 })).toEqual([]);
  });
});

describe("statusReasonError", () => {
  it("requires a reason when leaving completed/cancelled", () => {
    expect(statusReasonError("completed", "active", "")).toMatch(/reason/i);
    expect(statusReasonError("cancelled", "active", "client changed mind")).toBeNull();
    expect(statusReasonError("active", "on_hold", "")).toBeNull();
    expect(isClosedStatus("completed")).toBe(true);
    expect(isClosedStatus("active")).toBe(false);
  });
});
