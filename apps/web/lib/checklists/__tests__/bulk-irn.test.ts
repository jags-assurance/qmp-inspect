import { describe, expect, it } from "vitest";
import { BULK_IRN_MAX, isBulkIrnEligible, normaliseBulkIds, summariseBulk, toBulkItem } from "../bulk-irn";

describe("normaliseBulkIds", () => {
  it("trims, drops blanks and de-duplicates preserving order", () => {
    expect(normaliseBulkIds([" a ", "", "b", "a", 5])).toEqual({ ids: ["a", "b"], error: null });
  });
  it("errors on non-array or empty", () => {
    expect(normaliseBulkIds(null).error).toBeTruthy();
    expect(normaliseBulkIds([" "]).error).toBeTruthy();
  });
  it("enforces the cap but allows exactly the cap", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
    expect(normaliseBulkIds(ids(BULK_IRN_MAX)).error).toBeNull();
    expect(normaliseBulkIds(ids(BULK_IRN_MAX + 1)).error).toMatch(/at most/);
  });
});

describe("toBulkItem / summariseBulk", () => {
  it("maps outcomes", () => {
    const items = [
      toBulkItem("1", { error: null, irnNumber: "X-IRN-1" }),
      toBulkItem("2", { error: null, already: true }),
      toBulkItem("3", { error: "nope" }),
    ];
    expect(items.map((i) => i.status)).toEqual(["issued", "already", "skipped"]);
    expect(items[2].reason).toBe("nope");
    expect(summariseBulk(items)).toEqual({ issued: 1, already: 1, skipped: 1 });
  });
});

describe("isBulkIrnEligible", () => {
  const base = { overall_result: "pass" as const, irn_number: null, irn_voided: false };
  it("allows completed rows without a live IRN", () => {
    expect(isBulkIrnEligible(base)).toBe(true);
    expect(isBulkIrnEligible({ ...base, overall_result: "partial" })).toBe(true);
    expect(isBulkIrnEligible({ ...base, irn_number: "X", irn_voided: true })).toBe(true);
  });
  it("rejects fail, in-progress and live-IRN rows", () => {
    expect(isBulkIrnEligible({ ...base, overall_result: "fail" })).toBe(false);
    expect(isBulkIrnEligible({ ...base, overall_result: null })).toBe(false);
    expect(isBulkIrnEligible({ ...base, irn_number: "X" })).toBe(false);
  });
});
