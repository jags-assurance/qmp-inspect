import { describe, expect, it } from "vitest";
import { nextRevision, resolveUploadRevision } from "../revision";

describe("nextRevision", () => {
  it.each([
    ["0", "1"], ["9", "10"], ["A", "B"], ["b", "c"], ["Z", "AA"], ["AZ", "BA"], ["P1", "P2"], ["C02", "C03"], ["Rev 3", "Rev 4"],
  ])("%s -> %s", (prev, next) => expect(nextRevision(prev)).toBe(next));
  it("returns null when it can't tell", () => {
    expect(nextRevision("")).toBeNull();
    expect(nextRevision("A-draft")).toBeNull();
  });
});

describe("resolveUploadRevision", () => {
  it("first upload keeps what was typed, else 0", () => {
    expect(resolveUploadRevision("A", null)).toBe("A");
    expect(resolveUploadRevision("", null)).toBe("0");
    expect(resolveUploadRevision("0", undefined)).toBe("0");
  });
  it("the form's untouched 0 after Rev A becomes Rev B (was filed as Rev 0)", () => {
    expect(resolveUploadRevision("0", "A")).toBe("B");
    expect(resolveUploadRevision("", "A")).toBe("B");
    expect(resolveUploadRevision("", "2")).toBe("3");
  });
  it("keeps a revision the uploader typed, including a deliberate same-revision replace", () => {
    expect(resolveUploadRevision("C", "A")).toBe("C");
    expect(resolveUploadRevision("A", "A")).toBe("A");
    expect(resolveUploadRevision("0", "0")).toBe("0");
  });
});
