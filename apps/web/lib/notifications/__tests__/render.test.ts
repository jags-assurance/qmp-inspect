import { describe, expect, it } from "vitest";
import { escapeHtml, renderBrandedEmailHtml, renderNotificationEmailHtml, safeSitePath } from "../render";
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
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(html).toContain('href="https://app.example/inspect/x?a=1&amp;b=&quot;2&quot;"');
  });
  it("drops non-site links", () => {
    for (const l of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/a\nb"]) {
      expect(safeSitePath(l)).toBeNull();
    }
    expect(renderNotificationEmailHtml({ title: "t", link: "https://evil.example", appUrl: "https://a" })).not.toContain("evil.example");
    expect(escapeHtml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("branded email wrapper", () => {
  it("has header, button, footer links and automated note", () => {
    const html = renderNotificationEmailHtml({ title: "Hello", body: "Body", link: "/inspect/x", appUrl: "https://app.example/" });
    expect(html).toContain("#6b1e2c");
    expect(html).toContain("https://app.example/inspect/x");
    expect(html).toContain("Help and support");
    expect(html).toContain("/privacy");
    expect(html).toContain("/terms");
    expect(html).toContain("automated message");
    expect(html).toContain("max-width:600px");
  });
  it("escapes org brand and title, and rejects unsafe URLs", () => {
    const html = renderBrandedEmailHtml({
      title: "<b>x</b>",
      appUrl: "https://app.example",
      absoluteLink: "javascript:alert(1)",
      brand: { orgName: "<script>", orgLogoUrl: 'https://x/"onerror=1' },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror=1");
    expect(html).toContain("&lt;script&gt;");
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
  it("lists unacknowledged handovers and pending revisions and demands a reason", () => {
    const blockers = describeCloseBlockers({
      openNcrs: 0, openPunch: 0, overdueHolds: 0, draftInspections: 0, unacknowledgedHandovers: 1, pendingItpRevisions: 2,
    });
    expect(blockers).toEqual(["1 issued handover awaiting client acknowledgement", "2 ITP revisions awaiting approval"]);
    expect(closeOverrideReasonError(blockers, "x")).toMatch(/reason/);
    expect(closeOverrideReasonError(blockers, "client signed off")).toBeNull();
    expect(closeOverrideReasonError([], "")).toBeNull();
  });
});
