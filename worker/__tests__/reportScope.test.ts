import { describe, expect, it } from "vitest";
import { normaliseProjectId, packBasePath, packDocumentReference, resolveProjectScope } from "../src/jobs/reportScope";

const ID = "3F2504E0-4F89-11D3-9A0C-0305E82C3301";

describe("normaliseProjectId", () => {
  it("accepts a uuid (lower-cased) and rejects everything else", () => {
    expect(normaliseProjectId(ID)).toBe(ID.toLowerCase());
    expect(normaliseProjectId(" " + ID + " ")).toBe(ID.toLowerCase());
    for (const bad of ["", "abc", null, undefined, 5, "'; drop table projects;--"]) expect(normaliseProjectId(bad)).toBeNull();
  });
});

describe("packBasePath / packDocumentReference / packTitle", () => {
  it("keeps the organisation pack unchanged and separates a project pack", () => {
    expect(packBasePath("weekly-reports", "org", "2026-10-05", null)).toBe("weekly-reports/org/2026-10-05");
    expect(packBasePath("monthly-reports", "org", "2026-10", "p1")).toBe("monthly-reports/org/projects/p1/2026-10");
    expect(packDocumentReference("WEEKLY-2026-10-05", null)).toBe("WEEKLY-2026-10-05");
    expect(packDocumentReference("WEEKLY-2026-10-05", "p1")).toBe("WEEKLY-2026-10-05-PROJECT");
  });
});

describe("resolveProjectScope", () => {
  it("is unscoped for empty values and fails loudly for a malformed id", () => {
    expect(resolveProjectScope(undefined)).toBeNull();
    expect(resolveProjectScope(null)).toBeNull();
    expect(resolveProjectScope("")).toBeNull();
    expect(resolveProjectScope(ID)).toBe(ID.toLowerCase());
    expect(() => resolveProjectScope("not-a-uuid")).toThrow();
  });
});
