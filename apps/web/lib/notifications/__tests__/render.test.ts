import { describe, expect, it } from "vitest";
import { escapeHtml, renderNotificationEmailHtml, safeSitePath } from "../render";
import { isTempPasswordExpired, tempPasswordExpiry, tempPasswordTtlMs, generateTempPassword } from "@/lib/projects/temp-password";
import { closeOverrideReasonError, describeCloseBlockers } from "@/lib/projects/close-helpers";

describe("notification email rendering", () => {
  it("escapes HTML in title/body and in the link attribute", () => {
    const html = renderNotificationEmailHtml({
      title: "t",
      body: '<img src=x onerror="alert(1)">',
      link: "/inspect/x?a=1&b=\"2\"",
      appUrl: "https://app.example/",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain('href="https://app.example/inspect/x?a=1&amp;b=&quot;2&quot;"');
  });
  it("drops non-site links", () => {
    for (const l of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/a\nb"]) {
      expect(safeSitePath(l)).toBeNull();
    }
    expect(renderNotificationEmailHtml({ title: "t", link: "https://evil.example", appUrl: "https://a" })).not.toContain("href");
    expect(escapeHtml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("temp password", () => {
  it("is long, random and expires", () => {
    expect(generateTempPassword()).toHaveLength(22);
    expect(generateTempPassword()).not.toBe(generateTempPassword());
    expect(tempPasswordTtlMs({ TEMP_PASSWORD_TTL_HOURS: "1" })).toBe(3_600_000);
    expect(tempPasswordTtlMs({})).toBe(72 * 3_600_000);
    const exp = tempPasswordExpiry(0, {});
    expect(isTempPasswordExpired(exp, 1000)).toBe(false);
    expect(isTempPasswordExpired(exp, 73 * 3_600_000)).toBe(true);
    expect(isTempPasswordExpired(null)).toBe(false);
  });
});

describe("close helpers (new blockers)", () => {
  it("lists unissued books and pending revisions and demands a reason", () => {
    const blockers = describeCloseBlockers({
      openNcrs: 0, openPunch: 0, overdueHolds: 0, draftInspections: 0, unissuedDataBooks: 1, pendingItpRevisions: 2,
    });
    expect(blockers).toEqual(["1 unissued data book", "2 ITP revisions awaiting approval"]);
    expect(closeOverrideReasonError(blockers, "x")).toMatch(/reason/);
    expect(closeOverrideReasonError(blockers, "client signed off")).toBeNull();
    expect(closeOverrideReasonError([], "")).toBeNull();
  });
});
