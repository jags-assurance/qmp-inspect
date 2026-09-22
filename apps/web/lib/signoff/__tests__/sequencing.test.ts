// R67: configurable strict vs. flexible party-chain sequencing. resolveUnclearedLowerLevel is the
// pure decision logic behind findUnclearedLowerBlockingLevel in ../actions.ts — tested here without
// a live Supabase client. The 'flexible' cases below pin down today's exact pre-R67 behaviour
// (blocking-only sequencing) so a future change can't silently regress the default for every org
// that hasn't touched the new setting.
import { describe, expect, it } from "vitest";
import { resolveUnclearedLowerLevel } from "../sequencing";

const LEVELS = [
  { code: "CIR", label: "Client Internal Review", sort_order: 0, is_blocking: true },
  { code: "H", label: "Hold", sort_order: 1, is_blocking: true },
  { code: "W", label: "Witness", sort_order: 2, is_blocking: false },
  { code: "R", label: "Review", sort_order: 3, is_blocking: false },
];

describe("resolveUnclearedLowerLevel — flexible mode (default, pre-R67 behaviour)", () => {
  it("blocks a blocking level until a lower blocking level clears", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "H", false, [{ intervention: "CIR", status: "pending" }]);
    expect(result).toBe("Client Internal Review");
  });

  it("allows a blocking level once the lower blocking level is signed off", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "H", false, [{ intervention: "CIR", status: "signed_off" }]);
    expect(result).toBeNull();
  });

  it("allows a blocking level once the lower blocking level proceeded without response", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "H", false, [
      { intervention: "CIR", status: "proceeded_no_response" },
    ]);
    expect(result).toBeNull();
  });

  it("never blocks a non-blocking level, regardless of lower levels' status", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "R", false, [
      { intervention: "CIR", status: "pending" },
      { intervention: "H", status: "pending" },
      { intervention: "W", status: "pending" },
    ]);
    expect(result).toBeNull();
  });

  it("ignores non-blocking levels when checking a blocking level's lower levels", () => {
    // W (non-blocking) sits between CIR/H and R in sort_order in a hypothetical reorder, but here we
    // just confirm a blocking level's check never looks at non-blocking rows at all.
    const result = resolveUnclearedLowerLevel(LEVELS, "H", false, [{ intervention: "CIR", status: "signed_off" }, { intervention: "W", status: "pending" }]);
    expect(result).toBeNull();
  });
});

describe("resolveUnclearedLowerLevel — strict mode (R67)", () => {
  it("blocks a non-blocking level until an earlier non-blocking level clears", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "R", true, [
      { intervention: "CIR", status: "signed_off" },
      { intervention: "H", status: "signed_off" },
      { intervention: "W", status: "pending" },
    ]);
    expect(result).toBe("Witness");
  });

  it("allows a non-blocking level once every lower level (blocking and non-blocking) has cleared", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "R", true, [
      { intervention: "CIR", status: "signed_off" },
      { intervention: "H", status: "signed_off" },
      { intervention: "W", status: "signed_off" },
    ]);
    expect(result).toBeNull();
  });

  it("still blocks a blocking level on a lower blocking level, same as flexible mode", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "H", true, [{ intervention: "CIR", status: "pending" }]);
    expect(result).toBe("Client Internal Review");
  });

  it("the lowest-ordered level is never blocked by anything", () => {
    const result = resolveUnclearedLowerLevel(LEVELS, "CIR", true, []);
    expect(result).toBeNull();
  });
});
