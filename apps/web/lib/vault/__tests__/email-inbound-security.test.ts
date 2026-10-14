import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  extractEmailAddress,
  extractWebhookSecret,
  isSenderAllowed,
  validateAttachment,
} from "../email-inbound-security";

describe("email-inbound security", () => {
  it("compares secrets in constant time and handles length mismatch", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
  it("reads the secret from headers only", () => {
    const h = new Headers({ "x-vault-webhook-secret": "s1" });
    expect(extractWebhookSecret(h)).toBe("s1");
    expect(extractWebhookSecret(new Headers({ authorization: "Bearer tok" }))).toBe("tok");
    expect(extractWebhookSecret(new Headers())).toBeNull();
  });
  it("extracts sender addresses", () => {
    expect(extractEmailAddress("Jane Doe <Jane@Acme.com>")).toBe("jane@acme.com");
    expect(extractEmailAddress("no address")).toBeNull();
  });
  it("allows party emails and company domains but not free-mail domains or strangers", () => {
    const parties = ["site@contractor.example", "qa@gmail.com"];
    expect(isSenderAllowed("Site <site@contractor.example>", parties)).toBe(true);
    expect(isSenderAllowed("other@contractor.example", parties)).toBe(true);
    expect(isSenderAllowed("stranger@gmail.com", parties)).toBe(false);
    expect(isSenderAllowed("qa@gmail.com", parties)).toBe(true);
    expect(isSenderAllowed("x@evil.example", parties)).toBe(false);
    expect(isSenderAllowed("x@partner.example", parties, ["@partner.example"])).toBe(true);
  });
  it("limits attachment size and type", () => {
    expect(validateAttachment("a.pdf", "application/pdf", 1000)).toBeNull();
    expect(validateAttachment("a.exe", "application/pdf", 1000)).not.toBeNull();
    expect(validateAttachment("a.pdf", "application/pdf", 30 * 1024 * 1024)).not.toBeNull();
    expect(validateAttachment("a.bin", "application/x-msdownload", 10)).not.toBeNull();
    expect(validateAttachment("a.svg", "image/svg+xml", 10)).not.toBeNull();
  });
});

import { decideInbound, senderAuthenticationFailed } from "../email-inbound-security";

describe("quarantine decision (M10)", () => {
  const parties = ["site@contractor.example"];
  const ok = { from: "Site <site@contractor.example>", partyEmails: parties, extraAllowlist: [] as string[], body: {} };
  it("accepts a recognised sender", () => {
    expect(decideInbound(ok)).toEqual({ accept: true });
  });
  it("quarantines an unknown sender", () => {
    const d = decideInbound({ ...ok, from: "boss@evil.example" });
    expect(d.accept).toBe(false);
  });
  it("quarantines a recognised sender whose SPF failed (spoof)", () => {
    const body = { Headers: [{ Name: "Received-SPF", Value: "Fail (sender not authorised)" }] };
    const d = decideInbound({ ...ok, body });
    expect(d).toMatchObject({ accept: false });
    expect(senderAuthenticationFailed(body)).toBe(true);
  });
  it("treats missing or passing auth headers as not failed", () => {
    expect(senderAuthenticationFailed({})).toBe(false);
    expect(senderAuthenticationFailed({ Headers: [{ Name: "Received-SPF", Value: "Pass" }] })).toBe(false);
    expect(senderAuthenticationFailed({ Headers: [{ Name: "Authentication-Results", Value: "mx; dkim=fail; spf=pass" }] })).toBe(true);
  });
});
