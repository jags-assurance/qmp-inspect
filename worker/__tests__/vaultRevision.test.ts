import { describe, expect, it } from "vitest";
import {
  assertInspectionFileable,
  assertIrnFileable,
  assertNcrCloseoutFileable,
  buildGeneratedDirPath,
  buildGeneratedPath,
  computeNextRevision,
  selectSupersedable,
  shouldFileDataBook,
  shouldFileFatAsFinal,
  shouldFileOrgPacks,
} from "../src/jobs/vaultAutoFile";
import { retryDelayMs, shouldRetry } from "../src/jobs/retryPolicy";
import { PermanentJobError } from "../src/jobs/jobAbort";

describe("computeNextRevision", () => {
  it("starts at 0 when nothing is filed", () => {
    expect(computeNextRevision([])).toBe("0");
  });
  it("uses numeric max + 1", () => {
    expect(computeNextRevision([{ revision: "0" }, { revision: "3" }, { revision: "1" }])).toBe("4");
  });
  it("does not restart at 0 on non-numeric labels and stays unique", () => {
    expect(computeNextRevision([{ revision: "A" }])).toBe("1");
    expect(computeNextRevision([{ revision: "A" }, { revision: "1" }])).toBe("2");
    expect(computeNextRevision([{ revision: "A" }, { revision: "B" }, { revision: "2" }])).toBe("3");
  });
});

describe("selectSupersedable", () => {
  const rows = [
    { id: "a", revision: "0", status: "approved" },
    { id: "b", revision: "1", status: "rejected" },
    { id: "c", revision: "A", status: "approved" },
    { id: "d", revision: "2", status: "approved" },
    { id: "e", revision: "1", status: "superseded" },
  ];
  it("only supersedes approved rows with a lower numeric revision", () => {
    expect(selectSupersedable(rows, "2")).toEqual(["a"]);
    expect(selectSupersedable(rows, "3")).toEqual(["a", "d"]);
  });
  it("supports inclusive mode and ignores non-numeric new revisions", () => {
    expect(selectSupersedable(rows, "2", true)).toEqual(["a", "d"]);
    expect(selectSupersedable(rows, "A")).toEqual([]);
  });
});

describe("path builders", () => {
  it("is unique per timestamp and sanitises segments", () => {
    const a = buildGeneratedPath("irns/1", "IRN 001/x", "2", 1000);
    const b = buildGeneratedPath("irns/1", "IRN 001/x", "2", 1001);
    expect(a).toBe("irns/1/IRN_001_x-rev2-1000.pdf");
    expect(a).not.toBe(b);
    expect(buildGeneratedPath("ncrs/1/", "NCR-1", null, 5)).toBe("ncrs/1/NCR-1-5.pdf");
  });
  it("builds a directory path that keeps the file name", () => {
    expect(buildGeneratedDirPath("weekly/org/2026-01-05", "report-pack.pdf", 9)).toBe("weekly/org/2026-01-05/9/report-pack.pdf");
  });
});

describe("filing gates", () => {
  it("FAT only when completed; data book only when issued", () => {
    expect(shouldFileFatAsFinal("completed")).toBe(true);
    expect(shouldFileFatAsFinal("conditional_open")).toBe(false);
    expect(shouldFileDataBook("issued")).toBe(true);
    expect(shouldFileDataBook("compiled")).toBe(false);
  });
  it("throws permanent errors for non-final documents", () => {
    expect(() => assertInspectionFileable(null)).toThrow(PermanentJobError);
    expect(() => assertInspectionFileable("pass")).not.toThrow();
    expect(() => assertIrnFileable("2026-01-01")).toThrow(PermanentJobError);
    expect(() => assertIrnFileable(null)).not.toThrow();
    expect(() => assertNcrCloseoutFileable({ status: "open", root_cause: "x", corrective_action: "y", verification_notes: "z" })).toThrow();
    expect(() => assertNcrCloseoutFileable({ status: "closed", root_cause: "x", corrective_action: "y", verification_notes: "z" })).not.toThrow();
  });
  it("org packs are filed into project vaults only when explicitly enabled", () => {
    const prev = process.env.FILE_ORG_PACKS_IN_PROJECT_VAULTS;
    delete process.env.FILE_ORG_PACKS_IN_PROJECT_VAULTS;
    expect(shouldFileOrgPacks()).toBe(false);
    process.env.FILE_ORG_PACKS_IN_PROJECT_VAULTS = "true";
    expect(shouldFileOrgPacks()).toBe(true);
    if (prev === undefined) delete process.env.FILE_ORG_PACKS_IN_PROJECT_VAULTS;
    else process.env.FILE_ORG_PACKS_IN_PROJECT_VAULTS = prev;
  });
});

describe("retry policy", () => {
  it("retries transient errors up to 3 attempts with growing backoff", () => {
    expect(shouldRetry(1, new Error("x"))).toBe(true);
    expect(shouldRetry(3, new Error("x"))).toBe(false);
    expect(shouldRetry(1, new PermanentJobError("x"))).toBe(false);
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));
  });
});
