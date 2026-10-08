import { describe, expect, it } from "vitest";
import { PARTY_TYPE_LIMITS, checkPartyTypeLimit, isLimitedPartyType } from "../party-limits";

describe("party type limits (S1-13)", () => {
  it("has a limit for every party type the app knows", () => {
    expect(Object.keys(PARTY_TYPE_LIMITS).sort()).toEqual(["client", "jags", "main_contractor", "subcontractor", "tpi_lab", "vendor"]);
  });

  it("allows an addition below the cap and reports the slots left", () => {
    expect(checkPartyTypeLimit("client", 0)).toEqual({ ok: true, remaining: 10 });
    expect(checkPartyTypeLimit("client", 9)).toEqual({ ok: true, remaining: 1 });
  });

  it("refuses at the cap with a message naming the type and the limit", () => {
    const r = checkPartyTypeLimit("main_contractor", 10);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limit).toBe(10);
      expect(r.message).toContain("main contractor");
      expect(r.message).toContain("limit is 10");
    }
  });

  it("keeps refusing a project that is already over the cap, and phrases a count of one correctly", () => {
    expect(checkPartyTypeLimit("jags", 14).ok).toBe(false);
    const r = checkPartyTypeLimit("tpi_lab", 25);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("25 active TPI / lab parties");
  });

  it("does not block a type it has no rule for", () => {
    expect(isLimitedPartyType("toString")).toBe(false);
    expect(checkPartyTypeLimit("observer", 9999).ok).toBe(true);
  });
});

describe("database trigger stays in step with PARTY_TYPE_LIMITS", () => {
  it("uses the same cap for every party type", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = readFileSync(join(__dirname, "../../../../../supabase/migrations/20261118000500_project_party_type_limit.sql"), "utf8");
    for (const [type, limit] of Object.entries(PARTY_TYPE_LIMITS)) {
      expect(sql).toContain(`when '${type}' then ${limit}`);
    }
  });
});
