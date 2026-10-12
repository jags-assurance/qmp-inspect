import { describe, expect, it } from "vitest";
import { NOTIFICATION_HEAD_START_MS, pastHeadStart, renderNotificationEmailHtml, resolveRecipient } from "../src/notificationEmail";

const now = Date.parse("2026-12-01T10:00:00Z");

describe("worker notification emails", () => {
  it("renders like the web path: escaped text and a same-site link only", () => {
    expect(renderNotificationEmailHtml({ title: "T", body: "<b>x</b>", link: "/inspect/a", appUrl: "https://app.test/" })).toBe(
      '<p>&lt;b&gt;x&lt;/b&gt;</p><p><a href="https://app.test/inspect/a">Open in JAGS Assurance &rarr;</a></p>'
    );
    expect(renderNotificationEmailHtml({ title: "Title", body: " ", link: "//evil.com", appUrl: "https://app.test" })).toBe("<p>Title</p>");
  });

  it("leaves rows inside the 2-minute head start to the web app", () => {
    expect(pastHeadStart(new Date(now - NOTIFICATION_HEAD_START_MS + 1000).toISOString(), now)).toBe(false);
    expect(pastHeadStart(new Date(now - NOTIFICATION_HEAD_START_MS).toISOString(), now)).toBe(true);
  });

  it("resolves the address from the row, else the user, and skips inactive users", () => {
    expect(resolveRecipient(null, { email: "a@b.co", is_active: true })).toEqual({ send: true, email: "a@b.co" });
    expect(resolveRecipient("x@y.co", { email: "a@b.co", is_active: true })).toEqual({ send: true, email: "x@y.co" });
    expect(resolveRecipient(null, { email: "a@b.co", is_active: false }).send).toBe(false);
    expect(resolveRecipient(null, null).send).toBe(false);
  });
});
