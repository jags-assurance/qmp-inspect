import { describe, it, expect } from "vitest";
import { daysWaiting, isAckReminderDue, isFinalAckReminder, MAX_ACK_REMINDERS } from "../src/handoverReminderPolicy";

const DAY = 86_400_000;
const now = Date.parse("2026-11-20T12:00:00Z");
const base = { issuedAt: "2026-11-10", reminderCount: 0, lastReminderAt: null, hasPackage: true };

describe("handover acknowledgement reminders (S7-18)", () => {
  it("waits 3 days before the first reminder", () => {
    expect(isAckReminderDue({ ...base, issuedAt: new Date(now - 2 * DAY).toISOString() }, now)).toBe(false);
    expect(isAckReminderDue({ ...base, issuedAt: new Date(now - 3 * DAY).toISOString() }, now)).toBe(true);
  });
  it("then repeats weekly", () => {
    const state = { ...base, reminderCount: 1 };
    expect(isAckReminderDue({ ...state, lastReminderAt: new Date(now - 6 * DAY).toISOString() }, now)).toBe(false);
    expect(isAckReminderDue({ ...state, lastReminderAt: new Date(now - 7 * DAY).toISOString() }, now)).toBe(true);
  });
  it("stops after the maximum", () => {
    expect(isAckReminderDue({ ...base, reminderCount: MAX_ACK_REMINDERS, lastReminderAt: new Date(now - 30 * DAY).toISOString() }, now)).toBe(false);
  });
  it("never chases an acknowledged, rejected, superseded or package-less certificate", () => {
    expect(isAckReminderDue({ ...base, acknowledgedAt: "2026-11-12T00:00:00Z" }, now)).toBe(false);
    expect(isAckReminderDue({ ...base, rejectedAt: "2026-11-12T00:00:00Z" }, now)).toBe(false);
    expect(isAckReminderDue({ ...base, supersededAt: "2026-11-12T00:00:00Z" }, now)).toBe(false);
    expect(isAckReminderDue({ ...base, hasPackage: false }, now)).toBe(false);
  });
  it("flags the final reminder and counts waiting days", () => {
    expect(isFinalAckReminder(MAX_ACK_REMINDERS - 1)).toBe(true);
    expect(isFinalAckReminder(0)).toBe(false);
    expect(daysWaiting("2026-11-10", now)).toBe(10);
    expect(daysWaiting("bad", now)).toBe(0);
  });
});
