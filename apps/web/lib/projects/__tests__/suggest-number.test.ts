import { describe, expect, it } from "vitest";
import { organisationPrefix, suggestProjectNumber } from "../suggest-number";

describe("organisationPrefix", () => {
  it("uses initials for three or more words", () => {
    expect(organisationPrefix("Test Harbour Power")).toBe("THP");
    expect(organisationPrefix("GFL Engineering & Construction")).toBe("GEC");
  });
  it("uses the first three letters for one or two words", () => {
    expect(organisationPrefix("Meridian Energy")).toBe("MER");
    expect(organisationPrefix("Northgate")).toBe("NOR");
    expect(organisationPrefix("AB")).toBe("AB");
  });
  it("falls back for an empty name", () => {
    expect(organisationPrefix("  ")).toBe("PRJ");
  });
});

describe("suggestProjectNumber", () => {
  it("starts at 001", () => {
    expect(suggestProjectNumber("Test Harbour Power", 2026, [])).toBe("THP-2026-001");
  });
  it("continues after the highest existing number, ignoring other years and prefixes", () => {
    expect(
      suggestProjectNumber("Test Harbour Power", 2026, ["THP-2026-001", "THP-2026-0011", "THP-2025-007", "MER-2026-050"])
    ).toBe("THP-2026-012");
  });
  it("does not reuse a gap", () => {
    expect(suggestProjectNumber("Meridian Energy", 2026, ["MER-2026-001", "MER-2026-004"])).toBe("MER-2026-005");
  });
});
