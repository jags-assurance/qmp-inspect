import { describe, expect, it } from "vitest";
import { describeScopeChange, isEngagementScope, summarizeScopeChange } from "../scope-impact";

describe("summarizeScopeChange (S1-12)", () => {
  it("reports no impact and no confirmation for an unchanged scope", () => {
    const i = summarizeScopeChange("self_managed", "self_managed");
    expect(i).toMatchObject({ direction: "none", gains: [], losses: [], requiresConfirmation: false });
    expect(describeScopeChange("self_managed", "self_managed", i)).toBe("No change.");
  });

  it("lists only what one step up adds", () => {
    const hybrid = summarizeScopeChange("full_service", "self_managed");
    expect(hybrid.direction).toBe("upgrade");
    expect(hybrid.gains).toHaveLength(3);
    expect(hybrid.losses).toEqual([]);
    expect(hybrid.revokedPermissions).toBeNull();

    const full = summarizeScopeChange("self_managed", "client_managed");
    expect(full.gains).toHaveLength(2);
    expect(full.gains.join(" ")).toMatch(/approve their own ITPs/);
  });

  it("accumulates both tiers when jumping from full service to client-managed", () => {
    const i = summarizeScopeChange("full_service", "client_managed");
    expect(i.gains).toHaveLength(5);
  });

  it("lists what a downgrade removes, and the permissions revoked when leaving client-managed", () => {
    const i = summarizeScopeChange("client_managed", "self_managed", 4);
    expect(i.direction).toBe("downgrade");
    expect(i.gains).toEqual([]);
    expect(i.losses).toHaveLength(2);
    expect(i.revokedPermissions).toBe(4);
    expect(describeScopeChange("client_managed", "self_managed", i)).toMatch(/4 custom-role permissions/);

    const toFull = summarizeScopeChange("client_managed", "full_service", 1);
    expect(toFull.losses).toHaveLength(5);
    expect(describeScopeChange("client_managed", "full_service", toFull)).toMatch(/1 custom-role permission \(/);
  });

  it("does not claim permissions are revoked when leaving a tier that never had them", () => {
    expect(summarizeScopeChange("self_managed", "full_service", 9).revokedPermissions).toBeNull();
  });

  it("falls back to generic wording when the permission count is unknown", () => {
    const i = summarizeScopeChange("client_managed", "self_managed");
    expect(i.revokedPermissions).toBe(0);
    expect(describeScopeChange("client_managed", "self_managed", i)).toMatch(/Any custom-role permissions/);
  });

  it("always says existing records are untouched and requires confirmation for a change", () => {
    for (const [a, b] of [
      ["full_service", "client_managed"],
      ["client_managed", "full_service"],
    ] as const) {
      const i = summarizeScopeChange(a, b);
      expect(i.requiresConfirmation).toBe(true);
      expect(i.unchanged.join(" ")).toMatch(/not changed or removed/);
    }
  });

  it("recognises valid scopes only", () => {
    expect(isEngagementScope("self_managed")).toBe(true);
    expect(isEngagementScope("admin")).toBe(false);
    expect(isEngagementScope(null)).toBe(false);
  });
});
