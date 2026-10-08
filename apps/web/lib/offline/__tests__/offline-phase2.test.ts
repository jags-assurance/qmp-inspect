import { describe, expect, it } from "vitest";
import { ORIGIN_REJECTED_MESSAGE, isOriginRejection, itemGroupKey } from "../policy";
import { startInspectionMarkerPath } from "../idempotency";

describe("isOriginRejection", () => {
  it("is true only for a 403 carrying originRejected:true", () => {
    expect(isOriginRejection(403, { originRejected: true })).toBe(true);
    expect(isOriginRejection(403, { originRejected: "yes" })).toBe(false);
    expect(isOriginRejection(403, {})).toBe(false);
    expect(isOriginRejection(403, null)).toBe(false);
    expect(isOriginRejection(401, { originRejected: true })).toBe(false);
  });
  it("uses a message that does not claim the session expired", () => {
    expect(ORIGIN_REJECTED_MESSAGE.toLowerCase()).not.toContain("session expired");
    expect(ORIGIN_REJECTED_MESSAGE.toLowerCase()).toContain("origin");
  });
});

describe("itemGroupKey", () => {
  it("groups by inspection, then standalone assignment, else ungrouped", () => {
    expect(itemGroupKey({ fields: { inspection_record_id: "r1", assignment_id: "a1" } })).toBe("r1");
    expect(itemGroupKey({ fields: { assignment_id: "a1" } })).toBe("assignment:a1");
    expect(itemGroupKey({ fields: { template_id: "t" } })).toBe("");
  });
});

describe("startInspectionMarkerPath", () => {
  it("is deterministic per project and key, and sanitised", () => {
    expect(startInspectionMarkerPath("proj-1", "abc-123")).toBe("proj-1/inspections/idem-start-abc-123.json");
    expect(startInspectionMarkerPath("proj-1", "a/../b")).toBe("proj-1/inspections/idem-start-ab.json");
    expect(startInspectionMarkerPath("proj-1", "")).toBeNull();
    expect(startInspectionMarkerPath("", "abc")).toBeNull();
  });
});
