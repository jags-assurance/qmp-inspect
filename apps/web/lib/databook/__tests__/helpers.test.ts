import { describe, expect, it } from "vitest";
import {
  categoriesToOverrideItems,
  chunk,
  failingReadinessCategories,
  fetchAllRows,
  fetchInChunks,
  isPdfOutOfDate,
  isValidPackagePath,
  isValidSha256,
  validateBookFields,
} from "../helpers";
import type { DataBookReadiness, ReadinessCategory } from "../readiness";

const cat = (label: string, ready: number, total: number): ReadinessCategory => ({
  label,
  ready,
  total,
  percentage: total === 0 ? 100 : Math.round((ready / total) * 100),
});

function readiness(over: Partial<DataBookReadiness> = {}): DataBookReadiness {
  return {
    itps: cat("ITPs", 2, 2),
    inspectionRecords: cat("Records", 1, 3),
    checklists: cat("Checklists", 0, 0),
    calibrationRegister: cat("Cal", 1, 1),
    welderRegister: cat("Welder", 1, 1),
    personnelRegister: cat("Personnel", 1, 1),
    materialRegister: cat("Material", 1, 1),
    standaloneAssignments: cat("Standalone", 1, 1),
    ncrs: cat("NCRs", 0, 2),
    handoverCertificate: cat("Handover", 0, 1),
    openPunchItems: 4,
    overallPercentage: 50,
    isReady: false,
    ...over,
  };
}

describe("chunk", () => {
  it("splits into chunks of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
  });
});

describe("fetchAllRows", () => {
  it("loops pages until a short page", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const calls: [number, number][] = [];
    const out = await fetchAllRows<number>(async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1) };
    });
    expect(out).toHaveLength(2500);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("handles an exact-size final page", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const out = await fetchAllRows<number>(async (from, to) => ({ data: rows.slice(from, to + 1) }));
    expect(out).toHaveLength(1000);
  });
});

describe("fetchInChunks", () => {
  it("queries 200 ids at a time", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    const sizes: number[] = [];
    const out = await fetchInChunks(ids, async (c) => {
      sizes.push(c.length);
      return c;
    });
    expect(sizes).toEqual([200, 200, 50]);
    expect(out).toHaveLength(450);
  });
});

describe("package validation", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  it("requires the handover/<bookId>/ prefix and no traversal", () => {
    expect(isValidPackagePath(`handover/${id}/123-file.zip`, id)).toBe(true);
    expect(isValidPackagePath("handover/other/123-file.zip", id)).toBe(false);
    expect(isValidPackagePath(`handover/${id}/../x`, id)).toBe(false);
    expect(isValidPackagePath(`handover/${id}/`, id)).toBe(false);
  });
  it("validates sha256 hex", () => {
    expect(isValidSha256("a".repeat(64))).toBe(true);
    expect(isValidSha256("g".repeat(64))).toBe(false);
    expect(isValidSha256("abc")).toBe(false);
  });
});

describe("failing categories", () => {
  it("lists every failing category including punch", () => {
    const failing = failingReadinessCategories(readiness());
    expect(failing.map((f) => f.category)).toEqual(["Records", "NCRs", "Punch list items closed"]);
    expect(failing[0].outstanding).toBe(2);
    expect(failing[2].outstanding).toBe(4);
  });
  it("is empty when ready", () => {
    expect(
      failingReadinessCategories(readiness({ ncrs: cat("NCRs", 2, 2), inspectionRecords: cat("Records", 3, 3), openPunchItems: 0 }))
    ).toEqual([]);
  });
  it("converts to override items", () => {
    const items = categoriesToOverrideItems(failingReadinessCategories(readiness()));
    expect(items[0].description).toContain("2 outstanding");
    expect(items[0].id.startsWith("category:")).toBe(true);
  });
});

describe("validateBookFields", () => {
  it("requires and limits fields", () => {
    expect(validateBookFields("", "t")).not.toBeNull();
    expect(validateBookFields("x".repeat(100), "t")).toMatch(/Book number/);
    expect(validateBookFields("DB-1", "y".repeat(500))).toMatch(/Title/);
    expect(validateBookFields("DB-1", "Title")).toBeNull();
  });
});

describe("isPdfOutOfDate", () => {
  it("is true only when a change is newer than the PDF", () => {
    expect(isPdfOutOfDate("2026-01-02T00:00:00Z", ["2026-01-03T00:00:00Z"])).toBe(true);
    expect(isPdfOutOfDate("2026-01-02T00:00:00Z", ["2026-01-01T00:00:00Z", null])).toBe(false);
    expect(isPdfOutOfDate(null, ["2026-01-03T00:00:00Z"])).toBe(false);
  });
});
