import { describe, expect, it } from "vitest";
import {
  buildItemsSnapshot,
  duplicateTemplateName,
  isItemNumberTaken,
  isSnapshotStale,
  isTemplateFrozen,
  moveItem,
  nextTemplateVersion,
  planReorder,
  templateDeleteDecision,
  validateItemFields,
} from "../template-logic";

describe("isTemplateFrozen", () => {
  it("is frozen once any response exists", () => {
    expect(isTemplateFrozen(0)).toBe(false);
    expect(isTemplateFrozen(null)).toBe(false);
    expect(isTemplateFrozen(undefined)).toBe(false);
    expect(isTemplateFrozen(1)).toBe(true);
  });
});

describe("validateItemFields", () => {
  it("requires both fields and enforces lengths", () => {
    expect(validateItemFields({ itemNumber: " ", description: "x" })).toMatch(/required/);
    expect(validateItemFields({ itemNumber: "1", description: "" })).toMatch(/required/);
    expect(validateItemFields({ itemNumber: "x".repeat(21), description: "d" })).toMatch(/Item number is too long/);
    expect(validateItemFields({ itemNumber: "1", description: "d".repeat(501) })).toMatch(/Description is too long/);
    expect(validateItemFields({ itemNumber: "1.1", description: "Check weld" })).toBeNull();
  });
});

describe("isItemNumberTaken", () => {
  const items = [
    { id: "a", item_number: "1" },
    { id: "b", item_number: "2A" },
  ];
  it("detects duplicates case-insensitively and ignores the edited item", () => {
    expect(isItemNumberTaken(items, "2a")).toBe(true);
    expect(isItemNumberTaken(items, "2a", "b")).toBe(false);
    expect(isItemNumberTaken(items, "3")).toBe(false);
  });
});

describe("planReorder", () => {
  it("maps the requested order to sort_order 0..n-1", () => {
    const r = planReorder(["a", "b", "c"], ["c", "a", "b"]);
    expect(r).toEqual({ ok: true, order: [{ id: "c", sort_order: 0 }, { id: "a", sort_order: 1 }, { id: "b", sort_order: 2 }] });
  });
  it("rejects missing, extra, unknown and duplicate ids", () => {
    expect(planReorder(["a", "b"], ["a"]).ok).toBe(false);
    expect(planReorder(["a", "b"], ["a", "b", "c"]).ok).toBe(false);
    expect(planReorder(["a", "b"], ["a", "z"]).ok).toBe(false);
    expect(planReorder(["a", "b"], ["a", "a"]).ok).toBe(false);
  });
});

describe("moveItem", () => {
  it("swaps with the neighbour and stops at the edges", () => {
    expect(moveItem(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b"], "zzz", "up")).toEqual(["a", "b"]);
  });
  it("does not mutate its input", () => {
    const input = ["a", "b"];
    moveItem(input, "a", "down");
    expect(input).toEqual(["a", "b"]);
  });
});

describe("templateDeleteDecision", () => {
  it("only allows hard delete when no inspection record exists", () => {
    expect(templateDeleteDecision(0)).toBe("delete");
    expect(templateDeleteDecision(2)).toBe("archive_only");
  });
});

describe("buildItemsSnapshot", () => {
  it("orders by sort_order then natural item number and fills optional fields with null", () => {
    const snap = buildItemsSnapshot([
      { id: "3", item_number: "10", description: "c", is_mandatory: true, sort_order: 1 },
      { id: "2", item_number: "2", description: "b", is_mandatory: false, sort_order: 1, evidence_type: "photo" },
      { id: "1", item_number: "1", description: "a", is_mandatory: true, sort_order: 0, acceptance_criteria: "ok" },
    ]);
    expect(snap.map((s) => s.id)).toEqual(["1", "2", "3"]);
    expect(snap[0].acceptance_criteria).toBe("ok");
    expect(snap[1].evidence_type).toBe("photo");
    expect(snap[2].acceptance_criteria).toBeNull();
  });
});

describe("versioning helpers", () => {
  it("nextTemplateVersion increments and tolerates bad input", () => {
    expect(nextTemplateVersion(1)).toBe(2);
    expect(nextTemplateVersion(7)).toBe(8);
    expect(nextTemplateVersion(null)).toBe(2);
    expect(nextTemplateVersion(0)).toBe(2);
  });
  it("isSnapshotStale compares only when both versions are known", () => {
    expect(isSnapshotStale(1, 2)).toBe(true);
    expect(isSnapshotStale(2, 2)).toBe(false);
    expect(isSnapshotStale(null, 2)).toBe(false);
    expect(isSnapshotStale(1, undefined)).toBe(false);
  });
  it("duplicateTemplateName appends (copy) once", () => {
    expect(duplicateTemplateName(" Weld check ")).toBe("Weld check (copy)");
    expect(duplicateTemplateName("Weld check (copy)")).toBe("Weld check (copy)");
  });
});
