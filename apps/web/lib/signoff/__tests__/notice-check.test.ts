import { describe, it, expect } from "vitest";
import { dayInZone, evaluateNotice, startOfDayInZone } from "../notice-check";

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

describe("project time zone (S4-19)", () => {
  // 15 Jun 2026 22:30 UTC is already 16 Jun 02:30 in Dubai (UTC+4), still 15 Jun 18:30 in New York (UTC-4).
  const instant = new Date(Date.UTC(2026, 5, 15, 22, 30, 0));
  it("finds the calendar day in a zone", () => {
    expect(dayInZone(instant, "Asia/Dubai")).toBe("2026-06-16");
    expect(dayInZone(instant, "America/New_York")).toBe("2026-06-15");
  });
  it("computes the start of a day in a zone", () => {
    expect(new Date(startOfDayInZone("2026-06-16", "Asia/Dubai")).toISOString()).toBe("2026-06-15T20:00:00.000Z");
    expect(new Date(startOfDayInZone("2026-06-15", "America/New_York")).toISOString()).toBe("2026-06-15T04:00:00.000Z");
  });
  it("the same planned date is overdue in Dubai but still today in New York", () => {
    expect(evaluateNotice("2026-06-15", 24, "Hold", instant, "Asia/Dubai").status).toBe("overdue");
    expect(evaluateNotice("2026-06-15", 24, "Hold", instant, "America/New_York").status).toBe("short_notice");
  });
  it("an unknown zone falls back to server-local behaviour", () => {
    expect(evaluateNotice("2026-06-14", 24, "Hold", NOW, "Not/AZone").status).toBe("overdue");
  });
});
