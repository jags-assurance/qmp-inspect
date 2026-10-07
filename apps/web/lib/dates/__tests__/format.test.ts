import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatTime,
  isPastDueDate,
  resolveTimeZone,
  todayInZone,
} from "../format";

describe("dates/format", () => {
  const instant = "2026-10-31T22:30:00Z";

  it("renders the same instant differently per zone, deterministically", () => {
    expect(formatDate(instant, "UTC")).toBe("31/10/2026");
    expect(formatDate(instant, "Asia/Dubai")).toBe("01/11/2026"); // UTC+4 is already the next day
    expect(formatDateTime(instant, "Asia/Dubai")).toContain("02:30");
    expect(formatTime(instant, "America/Los_Angeles")).toBe("15:30");
  });

  it("falls back to UTC for a missing or invalid zone and never throws", () => {
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone("Not/AZone")).toBe("UTC");
    expect(formatDate(instant, "Not/AZone")).toBe("31/10/2026");
  });

  it("returns the fallback for empty or invalid input", () => {
    expect(formatDate(null, "UTC")).toBe("—");
    expect(formatDateTime("garbage", "UTC", "n/a")).toBe("n/a");
  });

  it("does not shift date-only values", () => {
    expect(formatDateOnly("2026-10-31")).toBe("31/10/2026");
    expect(formatDateOnly("2026-10-31T23:59:59Z")).toBe("31/10/2026");
    expect(formatDateOnly("nope")).toBe("—");
  });

  it("computes 'today' and overdue in the site zone, not UTC", () => {
    const now = new Date("2026-10-31T21:00:00Z"); // 01:00 on 1 Nov in Dubai
    expect(todayInZone("UTC", now)).toBe("2026-10-31");
    expect(todayInZone("Asia/Dubai", now)).toBe("2026-11-01");
    expect(isPastDueDate("2026-10-31", "UTC", now)).toBe(false);
    expect(isPastDueDate("2026-10-31", "Asia/Dubai", now)).toBe(true);
    expect(isPastDueDate(null, "UTC", now)).toBe(false);
  });
});
