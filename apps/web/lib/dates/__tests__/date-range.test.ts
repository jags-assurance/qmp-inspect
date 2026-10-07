import { describe, expect, it } from "vitest";
import {
  DATE_RANGE_LABELS,
  DATE_RANGE_OPTIONS,
  DEFAULT_DATE_RANGE,
  dateRangeToFromIso,
  parseDateRange,
} from "../date-range";

describe("parseDateRange", () => {
  it("accepts every known option", () => {
    for (const option of DATE_RANGE_OPTIONS) expect(parseDateRange(option)).toBe(option);
  });

  it("falls back to the default for missing or unknown values", () => {
    expect(parseDateRange(undefined)).toBe(DEFAULT_DATE_RANGE);
    expect(parseDateRange("")).toBe(DEFAULT_DATE_RANGE);
    expect(parseDateRange("365d")).toBe(DEFAULT_DATE_RANGE);
    expect(parseDateRange("7D")).toBe(DEFAULT_DATE_RANGE);
    expect(parseDateRange("constructor")).toBe(DEFAULT_DATE_RANGE);
  });

  it("honours a caller-supplied fallback", () => {
    expect(parseDateRange("nope", "all")).toBe("all");
    expect(parseDateRange("90d", "all")).toBe("90d");
  });

  it("has a label for every option", () => {
    for (const option of DATE_RANGE_OPTIONS) expect(DATE_RANGE_LABELS[option]).toBeTruthy();
  });
});

describe("dateRangeToFromIso", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("has no lower bound for 'all'", () => {
    expect(dateRangeToFromIso("all", now)).toBeNull();
  });

  it("goes back exactly 7, 30 and 90 days", () => {
    const days = (iso: string | null) => Math.round((now.getTime() - new Date(iso!).getTime()) / 86_400_000);
    expect(days(dateRangeToFromIso("7d", now))).toBe(7);
    expect(days(dateRangeToFromIso("30d", now))).toBe(30);
    expect(days(dateRangeToFromIso("90d", now))).toBe(90);
  });

  it("does not mutate the date passed in", () => {
    const input = new Date("2026-10-07T12:00:00.000Z");
    dateRangeToFromIso("30d", input);
    expect(input.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("returns an ISO-8601 UTC timestamp", () => {
    expect(dateRangeToFromIso("7d", now)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
