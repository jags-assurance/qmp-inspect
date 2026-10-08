import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupportEmail, parseSupportEmail } from "../contact";

describe("support email", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a plain address and trims it", () => {
    expect(parseSupportEmail("  help@example.com ")).toBe("help@example.com");
  });
  it("returns null for unset, blank or malformed values (the page then shows the placeholder)", () => {
    for (const v of [undefined, null, "", "   ", "not-an-email", "a@b", "two words@x.com", "x@y.com, z@y.com", "javascript:alert(1)"]) {
      expect(parseSupportEmail(v as string | null | undefined), String(v)).toBeNull();
    }
  });
  it("reads NEXT_PUBLIC_SUPPORT_EMAIL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "support@example.org");
    expect(getSupportEmail()).toBe("support@example.org");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "");
    expect(getSupportEmail()).toBeNull();
  });
});
