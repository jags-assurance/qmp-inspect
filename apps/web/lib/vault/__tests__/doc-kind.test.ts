import { describe, expect, it } from "vitest";
import { vaultDocKind, vaultFileType } from "../doc-kind";

describe("vaultDocKind", () => {
  const gen = (title: string) => vaultDocKind({ storagePath: "generated-documents:x/y.pdf", title });
  it("tells generated records apart by their title pattern", () => {
    expect(gen("GSP-ITP-007 — Weld NDT").key).toBe("itp");
    expect(gen("NCR GSP-NCR-002").key).toBe("ncr");
    expect(gen("NCR GSP-NCR-002 — Close-out certificate").key).toBe("ncr_closeout");
    expect(gen("Inspection Report INSP-1 — Coating").key).toBe("inspection_report");
    expect(gen("Something else").key).toBe("generated");
  });
  it("treats anything not under the generated-documents prefix as an upload", () => {
    expect(vaultDocKind({ storagePath: "vault/p/drawings/a.pdf", title: "NCR looking title" })).toMatchObject({ key: "upload", generated: false });
  });
});

describe("vaultFileType", () => {
  it("classifies by extension", () => {
    expect(vaultFileType("a/b/report.PDF").key).toBe("pdf");
    expect(vaultFileType("a/b/site.jpeg").key).toBe("photo");
    expect(vaultFileType("a/b/data.xlsx").label).toBe("XLSX");
    expect(vaultFileType(null).label).toBe("File");
  });
});
