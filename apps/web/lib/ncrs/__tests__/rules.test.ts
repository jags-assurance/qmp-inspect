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

describe("ncr rules edge cases", () => {
  it("clamps negative or NaN evidence counts to zero", () => {
    expect(evidenceCount(-3, 2)).toBe(2);
    expect(evidenceCount(Number.NaN, 0)).toBe(0);
  });
  it("rejects traversal, double slashes, other NCR folders and bare prefixes", () => {
    const ok = "p1/ncrs/n1/a.jpg";
    expect(isValidNcrPhotoPath("p1", "n1", ok)).toBe(true);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n1/")).toBe(false);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n2/a.jpg")).toBe(false);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs/n1/../n2/a.jpg")).toBe(false);
    expect(isValidNcrPhotoPath("p1", "n1", "p1/ncrs//n1/a.jpg")).toBe(false);
    expect(isValidNcrPhotoPath("p1", "n1", "/p1/ncrs/n1/a.jpg")).toBe(false);
    expect(isValidNcrPhotoPath("", "n1", ok)).toBe(false);
  });
  it("never lets anyone edit CAPA on a closed NCR, staff included", () => {
    expect(canEditCapa("closed", true)).toBe(false);
    expect(canEditCapa("open", false)).toBe(true);
  });
  it("does not treat a null party user as matching a null-ish user id", () => {
    expect(canWorkNcr({ isStaff: false, userId: "", raisedBy: null, assignedTo: null, partyUserId: null })).toBe(false);
  });
  it("trims whitespace when validating the return reason", () => {
    expect(validateReturnReason("          ")).not.toBeNull();
    expect(validateReturnReason("  1234567890  ")).toBeNull();
  });
  it("diffField treats undefined and null as equal", () => {
    expect(diffField(undefined, null)).toBeNull();
    expect(diffField("", null)).toEqual({ old: "", new: null });
  });
});
