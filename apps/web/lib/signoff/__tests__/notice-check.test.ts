import { describe, it, expect } from "vitest";
import { evaluateNotice } from "../notice-check";

// Local-time "now" (evaluateNotice uses local dates).
const NOW = new Date(2026, 5, 15, 10, 0, 0); // 15 Jun 2026 10:00 local

describe("evaluateNotice", () => {
  it("no planned date", () => {
    const r = evaluateNotice(null, 24, "Hold", NOW);
    expect(r).toMatchObject({ status: "no_planned_date", hoursUntilPlanned: null, message: null, requiredHours: 24 });
  });
  it("past date is overdue", () => {
    const r = evaluateNotice("2026-06-14", 24, "Hold", NOW);
    expect(r.status).toBe("overdue");
    expect(r.hoursUntilPlanned).toBeLessThan(0);
    expect(r.message).toContain("2026-06-14");
  });
  it("planned today with 24h required is short notice ('today')", () => {
    const r = evaluateNotice("2026-06-15", 24, "Witness", NOW);
    expect(r.status).toBe("short_notice");
    expect(r.message).toContain("Witness needs 24 h notice");
    expect(r.message).toContain("today");
  });
  it("planned tomorrow with 48h is short notice ('tomorrow')", () => {
    const r = evaluateNotice("2026-06-16", 48, "Hold", NOW);
    expect(r.status).toBe("short_notice");
    expect(r.message).toContain("tomorrow");
  });
  it("planned today counts through end of day", () => {
    expect(evaluateNotice("2026-06-15", 8, "Hold", NOW).status).toBe("ok"); // 14h left
    expect(evaluateNotice("2026-06-15", 15, "Hold", NOW).status).toBe("short_notice");
  });
  it("far-future date is ok with null message", () => {
    const r = evaluateNotice("2026-07-15", 72, "Hold", NOW);
    expect(r.status).toBe("ok");
    expect(r.message).toBeNull();
  });
  it("in N days wording", () => {
    const r = evaluateNotice("2026-06-18", 200, "Hold", NOW);
    expect(r.status).toBe("short_notice");
    expect(r.message).toContain("in 3 days");
  });
  it("default label is Hold", () => {
    expect(evaluateNotice("2026-06-15", 99, undefined, NOW).message).toMatch(/^Hold needs/);
  });
});
