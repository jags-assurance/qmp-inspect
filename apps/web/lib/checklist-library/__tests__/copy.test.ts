import { describe, it, expect } from "vitest";
import { libraryItemToChecklistItem, LIBRARY_ITEM_COLUMNS, LIBRARY_ITEM_BASE_COLUMNS } from "../copy";

const base = {
  item_number: "1",
  description: "Torque",
  acceptance_criteria: "within range",
  evidence_type: null,
  is_mandatory: true,
  sort_order: 1,
};

describe("libraryItemToChecklistItem", () => {
  it("carries numeric limits and unit", () => {
    const row = libraryItemToChecklistItem("t1", { ...base, value_type: "numeric", numeric_min: 10, numeric_max: 20, numeric_unit: "Nm" });
    expect(row).toMatchObject({ template_id: "t1", value_type: "numeric", numeric_min: 10, numeric_max: 20, numeric_unit: "Nm" });
  });
  it("omits numeric columns when the library schema predates them", () => {
    const row = libraryItemToChecklistItem("t1", base);
    expect(row).not.toHaveProperty("value_type");
    expect(row).not.toHaveProperty("numeric_min");
  });
  it("selects the numeric columns on top of the base ones", () => {
    expect(LIBRARY_ITEM_COLUMNS.startsWith(LIBRARY_ITEM_BASE_COLUMNS)).toBe(true);
    expect(LIBRARY_ITEM_COLUMNS).toContain("numeric_unit");
  });
});
