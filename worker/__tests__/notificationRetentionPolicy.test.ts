import { describe, expect, it } from "vitest";
import {
  isNotificationRetentionEnabled,
  notificationRetentionCutoffs,
  shouldDeleteNotification,
  shouldRunNotificationRetention,
} from "../src/notificationRetentionPolicy";

const NOW = Date.parse("2026-12-07T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86400000).toISOString();

describe("notification retention policy", () => {
  it("is off by default and only on for 'true'", () => {
    expect(isNotificationRetentionEnabled({})).toBe(false);
    expect(isNotificationRetentionEnabled({ NOTIFICATION_RETENTION_ENABLED: "1" })).toBe(false);
    expect(isNotificationRetentionEnabled({ NOTIFICATION_RETENTION_ENABLED: "true" })).toBe(true);
  });
  it("deletes read rows older than 90 days only", () => {
    expect(shouldDeleteNotification({ is_read: true, created_at: daysAgo(91) }, NOW)).toBe(true);
    expect(shouldDeleteNotification({ is_read: true, created_at: daysAgo(89) }, NOW)).toBe(false);
    expect(shouldDeleteNotification({ is_read: false, created_at: daysAgo(200) }, NOW)).toBe(false);
  });
  it("deletes anything older than 365 days", () => {
    expect(shouldDeleteNotification({ is_read: false, created_at: daysAgo(366) }, NOW)).toBe(true);
    expect(shouldDeleteNotification({ is_read: false, created_at: daysAgo(364) }, NOW)).toBe(false);
  });
  it("ignores unparseable dates", () => {
    expect(shouldDeleteNotification({ is_read: true, created_at: "nope" }, NOW)).toBe(false);
  });
  it("computes cutoffs and daily spacing", () => {
    const c = notificationRetentionCutoffs(NOW);
    expect(c.readBeforeIso).toBe(daysAgo(90));
    expect(c.anyBeforeIso).toBe(daysAgo(365));
    expect(shouldRunNotificationRetention(null, NOW)).toBe(true);
    expect(shouldRunNotificationRetention(NOW - 3600000, NOW)).toBe(false);
    expect(shouldRunNotificationRetention(NOW - 86400000, NOW)).toBe(true);
  });
});
