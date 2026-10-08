import { describe, it, expect } from "vitest";
import { hasAnyHash, matchFileHash, normaliseHash } from "../hash-match";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

describe("matchFileHash", () => {
  const known = { pdf_sha256s: [A], data_book_sha256: B, package_sha256: C };
  it("matches each recorded fingerprint and says which", () => {
    expect(matchFileHash(A, known)).toEqual({ matched: true, kind: "pdf" });
    expect(matchFileHash(B, known)).toEqual({ matched: true, kind: "data_book" });
    expect(matchFileHash(C, known)).toEqual({ matched: true, kind: "package" });
  });
  it("is case and whitespace insensitive", () => {
    expect(matchFileHash(`  ${A.toUpperCase()} `, known).matched).toBe(true);
  });
  it("does not match a different file", () => {
    expect(matchFileHash("d".repeat(64), known)).toEqual({ matched: false });
  });
  it("never matches an empty or malformed hash, even against empty records", () => {
    expect(matchFileHash("", { data_book_sha256: "" }).matched).toBe(false);
    expect(matchFileHash("abc", { pdf_sha256s: ["abc"] }).matched).toBe(false);
    expect(matchFileHash(A, { pdf_sha256s: null, data_book_sha256: null, package_sha256: null }).matched).toBe(false);
  });
});

describe("hasAnyHash / normaliseHash", () => {
  it("detects when there is anything to compare with", () => {
    expect(hasAnyHash({})).toBe(false);
    expect(hasAnyHash({ pdf_sha256s: [] })).toBe(false);
    expect(hasAnyHash({ pdf_sha256s: [A] })).toBe(true);
    expect(hasAnyHash({ package_sha256: C })).toBe(true);
  });
  it("normalises", () => {
    expect(normaliseHash(" AbC ")).toBe("abc");
    expect(normaliseHash(null)).toBe("");
  });
});
