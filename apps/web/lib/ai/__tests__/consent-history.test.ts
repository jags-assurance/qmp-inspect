import { describe, expect, it } from "vitest";
import { describeConsentChange, groupConsentHistory, type AiConsentHistoryRow } from "../consent-history";
import { aiEntryPointVisible } from "../gate-decision";

const row = (id: string, org: string, consent: boolean, at: string, name: string | null): AiConsentHistoryRow => ({
  id, organization_id: org, consent, changed_at: at, users: name ? { full_name: name } : null,
});

describe("consent history", () => {
  it("says who changed it, to what, and when", () => {
    const text = describeConsentChange(row("1", "o", false, "2026-10-01T09:30:00Z", "Ada Admin"));
    expect(text).toContain("Consent withdrawn by Ada Admin");
    expect(text).toContain("2026");
    expect(describeConsentChange(row("2", "o", true, "2026-10-01T09:30:00Z", null))).toContain("unknown user");
  });
  it("groups per organisation, newest first, capped", () => {
    const g = groupConsentHistory([
      row("a", "o1", true, "2026-01-01T00:00:00Z", "A"),
      row("b", "o1", false, "2026-02-01T00:00:00Z", "A"),
      row("c", "o2", true, "2026-03-01T00:00:00Z", "B"),
    ], 1);
    expect(g.get("o1")?.map((r) => r.id)).toEqual(["b"]);
    expect(g.get("o2")).toHaveLength(1);
  });
});

describe("aiEntryPointVisible", () => {
  it("hides AI controls without a key or without strict consent", () => {
    expect(aiEntryPointVisible(true, true)).toBe(true);
    expect(aiEntryPointVisible(true, false)).toBe(false);
    expect(aiEntryPointVisible(true, null)).toBe(false);
    expect(aiEntryPointVisible(true, undefined)).toBe(false);
    expect(aiEntryPointVisible(false, true)).toBe(false);
  });
});
