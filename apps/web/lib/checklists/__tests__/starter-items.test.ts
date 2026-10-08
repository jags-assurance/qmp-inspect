import { describe, expect, it } from "vitest";
import { buildStarterItems, isStarterChecklistName, starterChecklistName } from "../starter-items";

describe("buildStarterItems", () => {
  it("makes one mandatory item per acceptance-criterion line", () => {
    const items = buildStarterItems({ activity: "Rebar", acceptance_criteria: "- Cover >= 40mm\n2) Spacing 150mm; Ties fitted" });
    expect(items.map((i) => i.description)).toEqual(["Cover >= 40mm", "Spacing 150mm", "Ties fitted"]);
    expect(items.every((i) => i.is_mandatory)).toBe(true);
    expect(items.map((i) => i.item_number)).toEqual(["1", "2", "3"]);
  });
  it("falls back to the activity description, then a generic item", () => {
    expect(buildStarterItems({ activity: "Pour slab", acceptance_criteria: null })[0].description).toBe("Pour slab");
    expect(buildStarterItems({ activity: null, acceptance_criteria: " " })).toHaveLength(1);
  });
  it("marks the checklist name as an auto-generated starter", () => {
    expect(isStarterChecklistName(starterChecklistName("Pour slab"))).toBe(true);
    expect(isStarterChecklistName("Pour slab")).toBe(false);
  });
});
