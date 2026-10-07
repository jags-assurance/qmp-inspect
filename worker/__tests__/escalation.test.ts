import { describe, expect, it } from "vitest";
import { daysBetween, escalationTier, isDueSoon, siteDate } from "../src/escalation";

describe("siteDate", () => {
  it("uses the site offset, not UTC", () => {
    // 21:00 UTC on the 6th is already the 7th at UTC+4.
    expect(siteDate(new Date("2026-10-06T21:00:00Z"), 4)).toBe("2026-10-07");
    expect(siteDate(new Date("2026-10-06T21:00:00Z"), 0)).toBe("2026-10-06");
  });
});

describe("escalationTier", () => {
  it("is 0 until the day after the due date", () => {
    expect(escalationTier("2026-10-07", "2026-10-07")).toBe(0);
    expect(escalationTier("2026-10-07", "2026-10-06")).toBe(0);
  });
  it("climbs the ladder with days overdue", () => {
    expect(escalationTier("2026-10-07", "2026-10-08")).toBe(1);
    expect(escalationTier("2026-10-07", "2026-10-10")).toBe(2);
    expect(escalationTier("2026-10-07", "2026-10-14")).toBe(3);
  });
});

describe("isDueSoon", () => {
  it("covers today and the next two days only", () => {
    expect(isDueSoon("2026-10-07", "2026-10-07")).toBe(true);
    expect(isDueSoon("2026-10-09", "2026-10-07")).toBe(true);
    expect(isDueSoon("2026-10-10", "2026-10-07")).toBe(false);
    expect(isDueSoon("2026-10-06", "2026-10-07")).toBe(false);
  });
});

describe("daysBetween", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-10-01", "2026-10-08")).toBe(7);
  });
});
