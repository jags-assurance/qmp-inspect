import { describe, expect, it } from "vitest";
import { normaliseCode, previewNumber, slugifyForStorage, validateCode, validateSeparator } from "../validate";

describe("numbering validation", () => {
  it("accepts normal codes and rejects path-like or unicode ones", () => {
    expect(validateCode("Client code", normaliseCode(" acme-01 "))).toBeNull();
    expect(validateCode("Client code", "../X")).not.toBeNull();
    expect(validateCode("Client code", "A/B")).not.toBeNull();
    expect(validateCode("Client code", "אבג")).not.toBeNull();
    expect(validateCode("Client code", "")).not.toBeNull();
  });
  it("rejects slash and unknown separators", () => {
    expect(validateSeparator("-")).toBeNull();
    expect(validateSeparator("/")).not.toBeNull();
    expect(validateSeparator(" ")).not.toBeNull();
  });
  it("slugifies for storage keys", () => {
    expect(slugifyForStorage("JAGS/ACME ITP 001")).toBe("JAGS_ACME_ITP_001");
    expect(slugifyForStorage("..//")).not.toContain("/");
  });
  it("previews a number", () => {
    expect(previewNumber({ originator: "JAGS", clientCode: "ACME", docCode: "ITP", separator: "-", padding: 3, includeYear: true, next: 7, year: 2026 })).toBe(
      "JAGS-ACME-ITP-2026-007"
    );
  });
});
