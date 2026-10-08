import { describe, expect, it } from "vitest";
import { PERSONAL_DATA, RETENTION_PLACEHOLDER, SUBPROCESSOR_SUMMARY, USER_RIGHTS } from "../privacy-data";

describe("privacy notice data", () => {
  it("covers every category the brief requires", () => {
    const names = PERSONAL_DATA.map((r) => r.category.toLowerCase()).join("|");
    for (const needle of ["account", "access grants", "audit", "signature", "photos", "notifications", "email", "ai usage"]) {
      expect(names, needle).toContain(needle);
    }
  });

  it("gives every row a purpose and a retention statement, never an invented period", () => {
    for (const r of PERSONAL_DATA) {
      expect(r.purpose.length, r.category).toBeGreaterThan(10);
      expect(r.retention.length, r.category).toBeGreaterThan(10);
      // A number of years/months/days may only appear inside the sign-in window description or not at all.
      expect(r.retention, r.category).not.toMatch(/\b\d+\s*(years?|months?)\b/i);
    }
    expect(PERSONAL_DATA.some((r) => r.retention.includes(RETENTION_PLACEHOLDER))).toBe(true);
  });

  it("names the subprocessors actually used and lists user rights", () => {
    const names = SUBPROCESSOR_SUMMARY.map((s) => s.name).join("|");
    for (const n of ["Supabase", "Vercel", "Railway", "Resend", "Gemini", "Sentry"]) expect(names).toContain(n);
    expect(USER_RIGHTS.length).toBeGreaterThanOrEqual(4);
  });
});
