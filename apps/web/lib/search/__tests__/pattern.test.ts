import { describe, expect, it } from "vitest";
import { buildLikePattern } from "../pattern";

describe("buildLikePattern", () => {
  it("wraps a clean term", () => {
    expect(buildLikePattern("NCR-012")).toBe("*NCR-012*");
  });
  it("is null for short input", () => {
    expect(buildLikePattern("a")).toBeNull();
    expect(buildLikePattern("  ")).toBeNull();
  });
  it("strips characters that could inject extra filter clauses", () => {
    const p = buildLikePattern("x),status.eq.closed,(y")!;
    expect(p).not.toMatch(/[,()]/);
  });
  it("caps the length", () => {
    expect(buildLikePattern("a".repeat(200))!.length).toBeLessThanOrEqual(62);
  });
});
