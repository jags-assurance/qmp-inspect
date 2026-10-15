import { describe, expect, it } from "vitest";
import { projectParamOrActive, resolveActiveProjectId } from "../active-project";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("resolveActiveProjectId", () => {
  it("accepts a visible project (case-insensitive)", () => {
    expect(resolveActiveProjectId([A, B], B.toUpperCase())).toBe(B);
  });
  it("ignores a project the user cannot see", () => {
    expect(resolveActiveProjectId([A], B)).toBeNull();
  });
  it("ignores blank or malformed values", () => {
    expect(resolveActiveProjectId([A], "")).toBeNull();
    expect(resolveActiveProjectId([A], "not-a-uuid")).toBeNull();
    expect(resolveActiveProjectId([A], undefined)).toBeNull();
  });
});

describe("projectParamOrActive", () => {
  it("an explicit param wins, including the empty All-projects value", () => {
    expect(projectParamOrActive(B, A)).toBe(B);
    expect(projectParamOrActive("", A)).toBe("");
  });
  it("a missing param falls back to the header selection", () => {
    expect(projectParamOrActive(undefined, A)).toBe(A);
    expect(projectParamOrActive(undefined, null)).toBeUndefined();
  });
});
