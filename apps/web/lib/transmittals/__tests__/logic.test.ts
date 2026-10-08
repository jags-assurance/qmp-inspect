import { describe, expect, it } from "vitest";
import {
  MAX_TRANSMITTAL_RECIPIENTS,
  buildTransmittalSubject,
  canTransmit,
  isValidEmail,
  parseRecipients,
  renderTransmittalEmailHtml,
  transmittalLinkPath,
  validateTransmittalInput,
} from "../logic";

describe("recipient parsing", () => {
  it("splits on commas, semicolons, spaces and new lines, lower-cases and de-duplicates", () => {
    const r = parseRecipients("Ann@Example.com, bob@example.com;\n carol@example.org  ann@example.com");
    expect(r.valid).toEqual(["ann@example.com", "bob@example.com", "carol@example.org"]);
    expect(r.duplicates).toEqual(["ann@example.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("flags malformed addresses and accepts <angle> wrapped ones", () => {
    const r = parseRecipients("not-an-email, a@b, <ok@example.com>, x@y.z");
    expect(r.valid).toEqual(["ok@example.com", "x@y.z"]);
    expect(r.invalid).toEqual(["not-an-email", "a@b"]);
  });

  it("handles empty input", () => {
    expect(parseRecipients("")).toEqual({ valid: [], invalid: [], duplicates: [] });
    expect(parseRecipients(null)).toEqual({ valid: [], invalid: [], duplicates: [] });
  });

  it("rejects header-injection style input", () => {
    expect(isValidEmail("a@example.com\nBcc: evil@example.com")).toBe(false);
    expect(isValidEmail("a b@example.com")).toBe(false);
    expect(isValidEmail("a@@example.com")).toBe(false);
  });
});

describe("validateTransmittalInput", () => {
  it("returns the cleaned recipients and trimmed message", () => {
    const v = validateTransmittalInput({ recipientsText: "a@example.com a@example.com b@example.com", message: "  Please review.  " });
    expect(v).toEqual({ ok: true, recipients: ["a@example.com", "b@example.com"], message: "Please review.", warnings: ["Ignored 1 repeated address."] });
  });

  it("errors on none, invalid, too many, and an over-long message", () => {
    expect(validateTransmittalInput({ recipientsText: "", message: "" })).toEqual({ ok: false, error: "Enter at least one recipient email address." });
    const invalid = validateTransmittalInput({ recipientsText: "a@example.com, nope", message: "" });
    expect(invalid.ok).toBe(false);
    const many = Array.from({ length: MAX_TRANSMITTAL_RECIPIENTS + 1 }, (_, i) => `u${i}@example.com`).join(",");
    expect(validateTransmittalInput({ recipientsText: many, message: "" }).ok).toBe(false);
    expect(validateTransmittalInput({ recipientsText: "a@example.com", message: "x".repeat(2001) }).ok).toBe(false);
  });

  it("allows exactly the maximum number of recipients", () => {
    const max = Array.from({ length: MAX_TRANSMITTAL_RECIPIENTS }, (_, i) => `u${i}@example.com`).join(",");
    expect(validateTransmittalInput({ recipientsText: max, message: "" }).ok).toBe(true);
  });
});

describe("what may be transmitted", () => {
  it("allows only approved vault documents and issued Data Books", () => {
    expect(canTransmit("vault_document", "approved")).toBe(true);
    for (const s of ["for_review", "superseded", "rejected", null, undefined]) expect(canTransmit("vault_document", s)).toBe(false);
    expect(canTransmit("data_book", "issued")).toBe(true);
    for (const s of ["draft", "compiled", "withdrawn", null]) expect(canTransmit("data_book", s)).toBe(false);
  });

  it("links to the in-app page for each kind", () => {
    expect(transmittalLinkPath("vault_document", "p1", "d1")).toBe("/inspect/vault/p1/document/d1");
    expect(transmittalLinkPath("data_book", "p1", "b1")).toBe("/inspect/projects/p1/data-book");
  });
});

describe("email content", () => {
  it("keeps the subject on one bounded line", () => {
    const subject = buildTransmittalSubject("DWG-001\r\nBcc: x@y.com " + "z".repeat(400));
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.length).toBeLessThanOrEqual(300);
    expect(subject.startsWith("Document transmittal: DWG-001")).toBe(true);
  });

  it("escapes every user-influenced value and builds an absolute same-site link", () => {
    const html = renderTransmittalEmailHtml({
      entityLabel: '<img src=x onerror="a"> Plan',
      entityKind: "document",
      senderName: "O'Neil <staff>",
      message: "<script>alert(1)</script>",
      linkPath: "/inspect/vault/p1/document/d1",
      appUrl: "https://app.example.com/",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;a&quot;&gt; Plan");
    expect(html).toContain('href="https://app.example.com/inspect/vault/p1/document/d1"');
  });

  it("drops an off-site or protocol-relative link instead of emailing it", () => {
    for (const linkPath of ["//evil.example.com/x", "https://evil.example.com", "/\\evil.example.com"]) {
      const html = renderTransmittalEmailHtml({ entityLabel: "A", entityKind: "document", senderName: "S", message: null, linkPath, appUrl: "https://app.example.com" });
      expect(html).not.toContain("evil.example.com");
      expect(html).not.toContain("<a ");
    }
  });
});
