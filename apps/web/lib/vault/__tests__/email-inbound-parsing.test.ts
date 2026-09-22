// Unit tests for R20b's payload/address/subject parsing (lib/vault/email-inbound-parsing.ts).
// The route handler itself (app/api/vault/email-inbound/route.ts) touches Supabase storage and
// the DB, which this app's convention tests against a real DB rather than a mock (see
// completion-logic.test.ts's own comment) — everything genuinely pure was pulled out into this
// module specifically so it's directly testable without that.
import { describe, expect, it } from "vitest";
import {
  normalizeInboundPayload,
  parseProjectIdFromAddress,
  parseFolderKeyFromSubject,
  titleFromAttachmentFilename,
  DEFAULT_INBOUND_FOLDER_KEY,
} from "../email-inbound-parsing";

describe("normalizeInboundPayload", () => {
  it("accepts Postmark's PascalCase inbound-parse shape", () => {
    const result = normalizeInboundPayload({
      From: "engineer@contractor.example",
      To: "vault+11111111-1111-1111-1111-111111111111@inbound.jagsassurance.com",
      Subject: "[drawings] Rev 3 GA",
      Attachments: [{ Name: "GA-Rev3.pdf", Content: "YWJj", ContentType: "application/pdf" }],
    });
    expect(result).not.toBeNull();
    expect(result?.to).toContain("vault+11111111");
    expect(result?.attachments).toHaveLength(1);
    expect(result?.attachments[0].filename).toBe("GA-Rev3.pdf");
  });

  it("accepts the generic lowercase shape (e.g. SendGrid-style)", () => {
    const result = normalizeInboundPayload({
      from: "engineer@contractor.example",
      to: "vault+11111111-1111-1111-1111-111111111111@inbound.jagsassurance.com",
      subject: "hello",
      attachments: [{ filename: "a.txt", content: "YWJj", contentType: "text/plain" }],
    });
    expect(result?.attachments[0].filename).toBe("a.txt");
  });

  it("drops an attachment missing a filename or content", () => {
    const result = normalizeInboundPayload({
      to: "vault+11111111-1111-1111-1111-111111111111@x.com",
      attachments: [{ filename: "", content: "YWJj" }, { filename: "ok.txt", content: "" }],
    });
    expect(result?.attachments).toHaveLength(0);
  });

  it("returns null when there is no To address", () => {
    expect(normalizeInboundPayload({ attachments: [] })).toBeNull();
  });

  it("returns null when Attachments is missing or not an array", () => {
    expect(normalizeInboundPayload({ to: "vault+x@y.com" })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(normalizeInboundPayload(null)).toBeNull();
    expect(normalizeInboundPayload("not an object")).toBeNull();
  });
});

describe("parseProjectIdFromAddress", () => {
  it("extracts the project uuid from plus-addressing", () => {
    const id = parseProjectIdFromAddress("vault+aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@inbound.example.com");
    expect(id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns null when the address carries no vault+ token", () => {
    expect(parseProjectIdFromAddress("someone@example.com")).toBeNull();
  });
});

describe("parseFolderKeyFromSubject", () => {
  it("reads a recognised folder key token", () => {
    expect(parseFolderKeyFromSubject("[drawings] Rev 3")).toBe("drawings");
  });

  it("is case-insensitive", () => {
    expect(parseFolderKeyFromSubject("[CERTIFICATES] Mill cert")).toBe("certificates");
  });

  it("falls back to the default folder for an unrecognised token", () => {
    expect(parseFolderKeyFromSubject("[not_a_real_folder] hi")).toBe(DEFAULT_INBOUND_FOLDER_KEY);
  });

  it("falls back to the default folder when the subject has no token at all", () => {
    expect(parseFolderKeyFromSubject("Just a plain subject")).toBe(DEFAULT_INBOUND_FOLDER_KEY);
  });
});

describe("titleFromAttachmentFilename", () => {
  it("strips the extension and swaps separators for spaces", () => {
    expect(titleFromAttachmentFilename("GA_Rev-3.pdf")).toBe("GA Rev 3");
  });

  it("falls back to the raw filename if nothing is left after stripping", () => {
    expect(titleFromAttachmentFilename(".pdf")).toBe(".pdf");
  });
});
