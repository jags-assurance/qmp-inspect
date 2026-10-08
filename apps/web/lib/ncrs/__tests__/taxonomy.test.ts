import { describe, expect, it } from "vitest";
import { mergeCategories, parseSortOrder, slugifyCode, usableCode, validateLabel, type CategoryRow } from "../taxonomy";

describe("slugifyCode", () => {
  it("makes a storable code", () => {
    expect(slugifyCode("Poor site lighting!")).toBe("poor_site_lighting");
    expect(slugifyCode("  Ünïcode — résumé ")).toBe("unicode_resume");
    expect(slugifyCode("a".repeat(60)).length).toBeLessThanOrEqual(40);
  });
  it("flags unusable codes", () => {
    expect(usableCode(slugifyCode("!!"))).toBe(false);
    expect(usableCode(slugifyCode("QA"))).toBe(true);
  });
});

describe("validateLabel / parseSortOrder", () => {
  it("trims and bounds", () => {
    expect(validateLabel("  Hot   work ")).toEqual({ label: "Hot work" });
    expect(validateLabel("x")).toHaveProperty("error");
    expect(validateLabel("y".repeat(81))).toHaveProperty("error");
    expect(parseSortOrder("20")).toBe(20);
    expect(parseSortOrder("-1")).toBeNull();
    expect(parseSortOrder("12345")).toBeNull();
    expect(parseSortOrder("")).toBeNull();
  });
});

describe("mergeCategories", () => {
  const row = (over: Partial<CategoryRow>): CategoryRow => ({ id: "i", organization_id: null, code: "c", label: "L", sort_order: 10, is_active: true, ...over });
  it("lets an organisation row override a default with the same code and sorts", () => {
    const out = mergeCategories([
      row({ id: "1", code: "material", label: "Material", sort_order: 20 }),
      row({ id: "2", code: "design", label: "Design", sort_order: 10 }),
      row({ id: "3", code: "material", label: "Material (ours)", sort_order: 5, organization_id: "org" }),
    ]);
    expect(out.map((r) => r.label)).toEqual(["Material (ours)", "Design"]);
  });
});
