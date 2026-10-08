import { describe, expect, it } from "vitest";
import { AUTOMATION_RULE_TYPES, missingDefaultRules } from "../types";

describe("missingDefaultRules", () => {
  it("returns every rule type, enabled at the defaults, for an organisation with none", () => {
    const rows = missingDefaultRules("org-1", []);
    expect(rows.map((r) => r.rule_type).sort()).toEqual([...AUTOMATION_RULE_TYPES].sort());
    for (const r of rows) expect(r).toMatchObject({ organization_id: "org-1", enabled: true, threshold_hours: 24, repeat_hours: 24 });
  });

  it("never includes a type that already has a row, whatever its state", () => {
    const rows = missingDefaultRules("org-1", ["ncr_overdue", "hold_elapsed"]);
    expect(rows.map((r) => r.rule_type).sort()).toEqual(["punch_overdue", "register_expiry"]);
  });

  it("returns nothing when all rules exist", () => {
    expect(missingDefaultRules("org-1", AUTOMATION_RULE_TYPES)).toEqual([]);
  });
});
