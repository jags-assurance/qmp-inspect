import { describe, it, expect } from "vitest";
import {
  daysUntil,
  todayUtc,
  computeCalibrationStatus,
  computeWelderStatus,
  computePersonnelCertificationStatus,
  describeDays,
} from "../status";

const TODAY = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
function plus(days: number): string {
  return new Date(TODAY.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("todayUtc / daysUntil", () => {
  it("strips the time of day", () => {
    expect(todayUtc(new Date("2026-06-15T23:59:59Z")).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });
  it("counts whole days, negative when past", () => {
    expect(daysUntil("2026-06-15", TODAY)).toBe(0);
    expect(daysUntil("2026-06-16", TODAY)).toBe(1);
    expect(daysUntil("2026-06-14", TODAY)).toBe(-1);
  });
  it("accepts timestamps by using only the date part", () => {
    expect(daysUntil("2026-06-20T18:30:00Z", TODAY)).toBe(5);
  });
  it("is stable across a leap-day boundary", () => {
    expect(daysUntil("2028-03-01", new Date(Date.UTC(2028, 1, 28)))).toBe(2);
  });
});

describe("computeCalibrationStatus (30 day window)", () => {
  it.each([
    [-1, "expired"],
    [0, "due_soon"],
    [1, "due_soon"],
    [30, "due_soon"],
    [31, "valid"],
    [90, "valid"],
  ])("%i days -> %s", (d, s) => {
    expect(computeCalibrationStatus(plus(d), TODAY)).toBe(s);
  });
});

describe("computeWelderStatus (90 day window)", () => {
  it.each([
    [-1, "expired"],
    [0, "expiring"],
    [30, "expiring"],
    [31, "expiring"],
    [90, "expiring"],
    [91, "valid"],
  ])("%i days -> %s", (d, s) => {
    expect(computeWelderStatus(plus(d), TODAY)).toBe(s);
  });
});

describe("computePersonnelCertificationStatus (90 day window)", () => {
  it.each([
    [-5, "expired"],
    [0, "expiring_soon"],
    [90, "expiring_soon"],
    [91, "valid"],
  ])("%i days -> %s", (d, s) => {
    expect(computePersonnelCertificationStatus(plus(d), TODAY)).toBe(s);
  });
});

describe("describeDays", () => {
  it("formats singular/plural/today/overdue", () => {
    expect(describeDays(0)).toBe("due today");
    expect(describeDays(1)).toBe("in 1 day");
    expect(describeDays(12)).toBe("in 12 days");
    expect(describeDays(-1)).toBe("1 day overdue");
    expect(describeDays(-3)).toBe("3 days overdue");
  });
});
