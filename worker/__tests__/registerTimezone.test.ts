import { describe, expect, it } from "vitest";
import { todayInTimeZone } from "../src/jobs/registerStatus";

describe("worker todayInTimeZone", () => {
  it("uses the site's calendar day", () => {
    const now = new Date("2026-11-03T22:30:00Z");
    expect(todayInTimeZone("Asia/Dubai", now).toISOString().slice(0, 10)).toBe("2026-11-04");
    expect(todayInTimeZone(undefined, now).toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(todayInTimeZone("bogus", now).toISOString().slice(0, 10)).toBe("2026-11-03");
  });
});
