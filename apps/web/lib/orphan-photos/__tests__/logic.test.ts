import { describe, it, expect } from "vitest";
import { decisionNote, fileNameOf, formatBytes, isImagePath, isOrphanCandidatePath, isOrphanDecision, isRemoveConfirmed } from "../logic";

const U = "11111111-2222-3333-4444-555555555555";

describe("orphan photo logic", () => {
  it("requires the typed confirmation", () => {
    expect(isRemoveConfirmed("REMOVE FILE")).toBe(true);
    expect(isRemoveConfirmed("  remove file ")).toBe(true);
    expect(isRemoveConfirmed("remove")).toBe(false);
    expect(isRemoveConfirmed(null)).toBe(false);
  });
  it("only accepts the project/record/file path shape", () => {
    expect(isOrphanCandidatePath(`${U}/${U}/a.jpg`)).toBe(true);
    expect(isOrphanCandidatePath(`${U}/a.jpg`)).toBe(false);
    expect(isOrphanCandidatePath(`${U}/${U}/x/y.jpg`)).toBe(false);
    expect(isOrphanCandidatePath("../etc/passwd")).toBe(false);
  });
  it("validates decisions", () => {
    expect(isOrphanDecision("kept")).toBe(true);
    expect(isOrphanDecision("removed")).toBe(true);
    expect(isOrphanDecision("flagged")).toBe(false);
  });
  it("helpers", () => {
    expect(fileNameOf(`${U}/${U}/photo.JPG`)).toBe("photo.JPG");
    expect(isImagePath("a/b/photo.JPG")).toBe(true);
    expect(isImagePath("a/b/doc.pdf")).toBe(false);
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(null)).toBe("unknown size");
    expect(decisionNote("removed", " by hand ", true)).toContain("deleted from storage");
    expect(decisionNote("kept", "", false)).toBe("Kept.");
  });
});
