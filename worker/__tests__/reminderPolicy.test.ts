import { describe, expect, it } from "vitest";
import { escalationTier } from "../src/escalation";
import { isMissingSchemaError, isReminderSuppressed, reminderStep } from "../src/reminderPolicy";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe("reminderStep", () => {
  it("maps due-soon to step 0 and overdue items to their tier", () => {
    expect(reminderStep(true, 0)).toBe(0);
    expect(reminderStep(false, escalationTier("2026-10-09", "2026-10-10"))).toBe(1);
    expect(reminderStep(false, escalationTier("2026-10-07", "2026-10-10"))).toBe(2);
    expect(reminderStep(false, escalationTier("2026-10-01", "2026-10-10"))).toBe(3);
  });
});

describe("isReminderSuppressed", () => {
  it("never suppresses a step that has not been sent", () => {
    for (const step of [0, 1, 2, 3] as const) expect(isReminderSuppressed(step, null, 24, NOW)).toBe(false);
  });
  it("sends each non-final step once: suppressed for good however long ago it was sent", () => {
    for (const step of [0, 1, 2] as const) {
      expect(isReminderSuppressed(step, hoursAgo(1), 24, NOW)).toBe(true);
      expect(isReminderSuppressed(step, hoursAgo(24 * 30), 24, NOW)).toBe(true);
    }
  });
  it("repeats the final tier only after the repeat window", () => {
    expect(isReminderSuppressed(3, hoursAgo(23), 24, NOW)).toBe(true);
    expect(isReminderSuppressed(3, hoursAgo(25), 24, NOW)).toBe(false);
  });
  it("a tier change is not held back by the previous tier's send", () => {
    // Sent at tier 1 an hour ago; now tier 2: nothing recorded for step 2, so it fires immediately.
    expect(isReminderSuppressed(2, null, 24, NOW)).toBe(false);
  });
  it("treats an unreadable timestamp on the final step as not sent", () => {
    expect(isReminderSuppressed(3, "garbage", 24, NOW)).toBe(false);
  });
});

describe("isMissingSchemaError", () => {
  it("recognises a missing column and ignores other errors", () => {
    expect(isMissingSchemaError({ code: "42703" })).toBe(true);
    expect(isMissingSchemaError({ message: "Could not find the 'tier' column of 'automation_notification_log' in the schema cache" })).toBe(true);
    expect(isMissingSchemaError({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
  });
});
