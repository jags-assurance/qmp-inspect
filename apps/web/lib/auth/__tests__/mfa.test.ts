import { describe, expect, it } from "vitest";
import { isMfaExemptPath, mfaChallengePath, mfaEnabled, needsMfaChallenge, normaliseTotpCode } from "../mfa";

describe("mfaEnabled", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(mfaEnabled({})).toBe(false);
    expect(mfaEnabled({ NEXT_PUBLIC_ENABLE_MFA: "0" })).toBe(false);
    expect(mfaEnabled({ NEXT_PUBLIC_ENABLE_MFA: "true" })).toBe(false);
    expect(mfaEnabled({ NEXT_PUBLIC_ENABLE_MFA: "1" })).toBe(true);
  });
});

describe("needsMfaChallenge", () => {
  it("only when a factor exists (next aal2) and the session is not yet aal2", () => {
    expect(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(needsMfaChallenge({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(needsMfaChallenge(null)).toBe(false);
  });
});

describe("normaliseTotpCode", () => {
  it("accepts six digits, with spaces, and nothing else", () => {
    expect(normaliseTotpCode("123456")).toBe("123456");
    expect(normaliseTotpCode(" 123 456 ")).toBe("123456");
    for (const bad of ["12345", "1234567", "12345a", "", null, undefined]) expect(normaliseTotpCode(bad as string)).toBeNull();
  });
});

describe("paths", () => {
  it("builds the challenge path and exempts only the plumbing", () => {
    expect(mfaChallengePath("/inspect/ncrs?x=1")).toBe("/login/mfa?next=%2Finspect%2Fncrs%3Fx%3D1");
    expect(isMfaExemptPath("/login/mfa")).toBe(true);
    expect(isMfaExemptPath("/auth/confirm")).toBe(true);
    expect(isMfaExemptPath("/inspect")).toBe(false);
  });
});
