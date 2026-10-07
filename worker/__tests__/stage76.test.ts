import { describe, expect, it } from "vitest";
import { DATA_BOOK_JOB_TIMEOUT_MS, DEFAULT_JOB_TIMEOUT_MS, jobTimeoutMs, orphanAction, pickClaimable, MAX_JOB_ATTEMPTS } from "../src/jobs/retryPolicy";
import { hashTag, sourceHash, stableStringify, tagFromPath } from "../src/jobs/generatedDocument";
import { buildGeneratedPath } from "../src/jobs/vaultAutoFile";
import { BIDI_CSS, withBidi } from "../src/jobs/bidi";
import { buildVerifyUrl, qrDataUri, verifyBlockHtml } from "../src/jobs/verification";

describe("per-job-type timeouts", () => {
  it("gives the Data Book a long budget and the certificate variant a short one", () => {
    expect(jobTimeoutMs("render_data_book_pdf", {})).toBe(DATA_BOOK_JOB_TIMEOUT_MS);
    expect(jobTimeoutMs("render_data_book_pdf", { variant: "handover_certificate" })).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(jobTimeoutMs("render_irn_pdf")).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(DATA_BOOK_JOB_TIMEOUT_MS).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });
});

describe("orphan recovery", () => {
  it("requeues while attempts remain and fails afterwards", () => {
    expect(orphanAction(1)).toBe("requeue");
    expect(orphanAction(MAX_JOB_ATTEMPTS)).toBe("fail");
  });
});

describe("pickClaimable", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  const job = (id: string, attempts: number, created: string, updated?: string) => ({ id, attempts, created_at: created, updated_at: updated ?? created });
  it("is not starved by retries still in backoff and prefers never-attempted jobs", () => {
    const backoff = Array.from({ length: 15 }, (_, i) => job(`r${i}`, 2, "2026-10-07T10:00:00Z", "2026-10-07T11:59:00Z"));
    const fresh = job("fresh", 0, "2026-10-07T11:00:00Z");
    expect(pickClaimable([...backoff, fresh], now)?.id).toBe("fresh");
  });
  it("picks a retry whose backoff elapsed when nothing fresh waits", () => {
    expect(pickClaimable([job("a", 1, "2026-10-07T08:00:00Z", "2026-10-07T09:00:00Z")], now)?.id).toBe("a");
    expect(pickClaimable([job("b", 1, "2026-10-07T08:00:00Z", "2026-10-07T11:59:50Z")], now)).toBeNull();
  });
  it("respects the in-memory block list", () => {
    expect(pickClaimable([job("x", 0, "2026-10-07T08:00:00Z")], now, () => true)).toBeNull();
  });
});

describe("source hashing", () => {
  it("is key-order independent and changes with content", () => {
    expect(sourceHash({ a: 1, b: { c: [1, 2] } })).toBe(sourceHash({ b: { c: [1, 2] }, a: 1 }));
    expect(sourceHash({ a: 1 })).not.toBe(sourceHash({ a: 2 }));
    expect(stableStringify({ d: new Date("2026-01-01T00:00:00Z"), u: undefined })).toBe('{"d":"2026-01-01T00:00:00.000Z"}');
  });
  it("round-trips the tag through the generated path", () => {
    const tag = hashTag(sourceHash({ x: 1 }));
    const path = buildGeneratedPath("irns/abc", "GSP-IRN-1", "2", 1700000000000, tag);
    expect(path).toBe(`irns/abc/GSP-IRN-1-rev2-h${tag}-1700000000000.pdf`);
    expect(tagFromPath(path)).toBe(tag);
    expect(tagFromPath("irns/abc/GSP-IRN-1-rev2-1700000000000.pdf")).toBeNull();
    // Unchanged signature for existing callers.
    expect(buildGeneratedPath("p", "b", null, 5)).toBe("p/b-5.pdf");
  });
});

describe("bidi support", () => {
  it("injects the plaintext direction rule before </head>", () => {
    const out = withBidi("<html><head><title>x</title></head><body>محمد</body></html>");
    expect(out).toContain(BIDI_CSS);
    expect(out.indexOf("data-bidi")).toBeLessThan(out.indexOf("</head>"));
    expect(withBidi("<p>x</p>").startsWith("<style")).toBe(true);
  });
});

describe("verification QR", () => {
  const token = "ab".repeat(32);
  it("builds the public URL only with a well-formed token and a base", () => {
    expect(buildVerifyUrl("irn", token, "https://app.example.com/")).toBe(`https://app.example.com/verify/irn/${token}`);
    expect(buildVerifyUrl("irn", null, "https://app.example.com")).toBeNull();
    expect(buildVerifyUrl("certificate", "short", "https://app.example.com")).toBeNull();
    expect(buildVerifyUrl("certificate", token, undefined as unknown as string)).toBeNull();
  });
  it("renders a PNG data URI and an empty block when there is no QR", async () => {
    const uri = await qrDataUri("https://app.example.com/verify/irn/x");
    expect(uri?.startsWith("data:image/png;base64,")).toBe(true);
    expect(await qrDataUri(null)).toBeNull();
    expect(verifyBlockHtml(null, null, (s) => s)).toBe("");
    expect(verifyBlockHtml(uri, "https://x/verify", (s) => s)).toContain("Verify this document");
  });
});
