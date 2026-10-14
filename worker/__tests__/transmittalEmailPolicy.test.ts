import { describe, expect, it } from "vitest";
import {
  MAX_TRANSMITTAL_ATTEMPTS,
  isTransmittalDue,
  outcomeAfterFailure,
  sanitizeEmailError,
  transmittalRetryDelayMs,
} from "../src/transmittalEmailPolicy";

const now = Date.parse("2026-11-12T10:00:00Z");
const MIN = 60_000;

describe("transmittal email retry policy (S7-26)", () => {
  it("backs off 5 min, 15 min, 1 h, then 4 h", () => {
    expect([1, 2, 3, 4, 9].map(transmittalRetryDelayMs)).toEqual([5 * MIN, 15 * MIN, 60 * MIN, 240 * MIN, 240 * MIN]);
  });

  it("is due only while pending, under the attempt cap, and past next_attempt_at", () => {
    const row = { status: "pending", attempts: 1, nextAttemptAt: new Date(now - MIN).toISOString() };
    expect(isTransmittalDue(row, now)).toBe(true);
    expect(isTransmittalDue({ ...row, nextAttemptAt: new Date(now + MIN).toISOString() }, now)).toBe(false);
    expect(isTransmittalDue({ ...row, nextAttemptAt: null }, now)).toBe(true);
    expect(isTransmittalDue({ ...row, status: "sent" }, now)).toBe(false);
    expect(isTransmittalDue({ ...row, status: "failed" }, now)).toBe(false);
    expect(isTransmittalDue({ ...row, attempts: MAX_TRANSMITTAL_ATTEMPTS }, now)).toBe(false);
  });

  it("keeps a failed send pending with a later retry time until the cap, then gives up", () => {
    const first = outcomeAfterFailure(1, now);
    expect(first).toEqual({ status: "pending", attempts: 2, nextAttemptAt: new Date(now + 15 * MIN).toISOString() });
    const last = outcomeAfterFailure(MAX_TRANSMITTAL_ATTEMPTS - 1, now);
    expect(last).toEqual({ status: "failed", attempts: MAX_TRANSMITTAL_ATTEMPTS, nextAttemptAt: null });
  });

  it("bounds and scrubs error text", () => {
    const msg = sanitizeEmailError("Resend API returned 401:\n Bearer re_abc123.def failed " + "x".repeat(900));
    expect(msg).not.toContain("re_abc123");
    expect(msg).not.toContain("\n");
    expect(msg.length).toBeLessThanOrEqual(500);
  });
});

import { TRANSMITTAL_DOWNLOAD_PLACEHOLDER, canSignTransmittal, injectDownloadBlock, renderDownloadBlock } from "../src/transmittalEmailPolicy";

describe("download block (M5)", () => {
  it("signs only approved documents and issued Data Books", () => {
    expect(canSignTransmittal("vault_document", "approved")).toBe(true);
    expect(canSignTransmittal("vault_document", "for_review")).toBe(false);
    expect(canSignTransmittal("data_book", "issued")).toBe(true);
    expect(canSignTransmittal("data_book", "compiled")).toBe(false);
    expect(canSignTransmittal("other", "approved")).toBe(false);
  });
  it("renders signed and verify links, escaped, https only", () => {
    const html = renderDownloadBlock({ signedUrl: "https://x.supabase.co/s?token=a&b=1", verifyUrl: "https://app.example.com/verify/certificate/abc", entityKind: "document" });
    expect(html).toContain("token=a&amp;b=1");
    expect(html).toContain("expires in 7 days");
    expect(html).toContain("/verify/certificate/abc");
    expect(renderDownloadBlock({ signedUrl: "javascript:alert(1)", verifyUrl: null, entityKind: "document" })).toBe("");
  });
  it("substitutes or removes the placeholder", () => {
    const body = `<p>a</p>${TRANSMITTAL_DOWNLOAD_PLACEHOLDER}<p>b</p>`;
    expect(injectDownloadBlock(body, "<i>x</i>")).toBe("<p>a</p><i>x</i><p>b</p>");
    expect(injectDownloadBlock(body, "")).toBe("<p>a</p><p>b</p>");
  });
  it("redacts signed URLs from stored errors", () => {
    expect(sanitizeEmailError("bad https://x.co/o/s?token=eyJabc.def rest")).toBe("bad [redacted-url] rest");
  });
});
