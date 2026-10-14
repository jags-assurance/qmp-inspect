import { describe, expect, it } from "vitest";
import { validateDeactivationReason, validateOrganizationName } from "../lifecycle";

describe("organisation lifecycle validation", () => {
  it("normalises and requires a name", () => {
    expect(validateOrganizationName("  Acme   Power  ")).toEqual({ name: "Acme Power", error: null });
    expect(validateOrganizationName("   ").error).toBeTruthy();
    expect(validateOrganizationName("x".repeat(121)).error).toBeTruthy();
  });
  it("requires a deactivation reason", () => {
    expect(validateDeactivationReason("  ").error).toBeTruthy();
    expect(validateDeactivationReason(" contract ended ")).toEqual({ reason: "contract ended", error: null });
    expect(validateDeactivationReason("y".repeat(501)).error).toBeTruthy();
  });
});
