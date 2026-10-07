import { describe, expect, it } from "vitest";
import { buildManifestCsv, sanitizeZipSegment } from "../zip-helpers";

describe("sanitizeZipSegment", () => {
  it("never yields a traversal segment", () => {
    expect(sanitizeZipSegment("..")).toBe("file");
    expect(sanitizeZipSegment("../../etc")).not.toContain("/");
    expect(sanitizeZipSegment(".hidden")).toBe("hidden");
  });
  it("removes separators and control characters but keeps non-ASCII", () => {
    expect(sanitizeZipSegment("a/b\\c\u0007d")).toBe("a-b-cd");
    expect(sanitizeZipSegment("محمد — rev0")).toBe("محمد — rev0");
  });
  it("falls back for empty names and bounds the length", () => {
    expect(sanitizeZipSegment("   ")).toBe("file");
    expect(sanitizeZipSegment("x".repeat(400))).toHaveLength(150);
  });
});

describe("buildManifestCsv", () => {
  it("writes a header, quotes cells and neutralises formulas", () => {
    const csv = buildManifestCsv([
      { path: "A/b.pdf", title: 'Say "hi", ok', documentNumber: null, revision: "0", status: "approved", sizeBytes: 12, sha256: "ab".repeat(32) },
      { path: "A/c.pdf", title: "=HYPERLINK(1)", documentNumber: "D-1", revision: "1", status: "approved", sizeBytes: 3, sha256: "cd".repeat(32) },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("path,title,document_number,revision,status,size_bytes,sha256");
    expect(lines[1]).toContain('"Say ""hi"", ok"');
    expect(lines[2]).toContain("'=HYPERLINK(1)");
  });
});
