import { describe, expect, it } from "vitest";
import {
  canEditAssignment,
  canEditCapa,
  canWorkNcr,
  diffField,
  evidenceCount,
  isValidNcrPhotoPath,
  severityLabel,
  validateReturnReason,
} from "../rules";

describe("ncr rules", () => {
  it("counts photos and documents as evidence", () => {
    expect(evidenceCount(0, 0)).toBe(0);
    expect(evidenceCount(0, 2)).toBe(2);
    expect(evidenceCount(1, 1)).toBe(2);
  });

  it("validates photo paths", () => {
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n1/a.jpg")).toBe(true);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n2/a.jpg")).toBe(false);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n1/")).toBe(false);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n1/../x.jpg")).toBe(false);
  });

  it("lets the responsible party user work the NCR", () => {
    const base = { isStaff: false, userId: "u", raisedBy: "r", assignedTo: "a", partyUserId: null };
    expect(canWorkNcr(base)).toBe(false);
    expect(canWorkNcr({ ...base, partyUserId: "u" })).toBe(true);
    expect(canWorkNcr({ ...base, isStaff: true })).toBe(true);
  });

  it("restricts assignment edits to staff or raiser", () => {
    expect(canEditAssignment({ isStaff: false, userId: "a", raisedBy: "r" })).toBe(false);
    expect(canEditAssignment({ isStaff: false, userId: "r", raisedBy: "r" })).toBe(true);
  });

  it("locks CAPA for non-staff while pending verification", () => {
    expect(canEditCapa("pending_verification", false)).toBe(false);
    expect(canEditCapa("pending_verification", true)).toBe(true);
    expect(canEditCapa("in_progress", false)).toBe(true);
    expect(canEditCapa("closed", true)).toBe(false);
  });

  it("requires a 10 char return reason", () => {
    expect(validateReturnReason("short")).not.toBeNull();
    expect(validateReturnReason("long enough reason")).toBeNull();
  });

  it("formats severity and diffs", () => {
    expect(severityLabel("minor_ncr")).toBe("Minor NCR");
    expect(diffField("a", "a")).toBeNull();
    expect(diffField(null, "b")).toEqual({ old: null, new: "b" });
  });
});
