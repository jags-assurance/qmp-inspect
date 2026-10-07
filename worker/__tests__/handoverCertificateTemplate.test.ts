import { describe, expect, it } from "vitest";
import { buildHandoverCertificateHtml, safeSignatureDataUri, type HandoverCertificatePdfData } from "../src/jobs/handoverCertificateTemplate";

const base: HandoverCertificatePdfData = {
  certificateNumber: "HC-001",
  issuedDate: "2026-10-07",
  issuedByName: "Oliver Bennett",
  bookNumber: "DB-001",
  bookTitle: "Final <Data> Book",
  bookRevision: "1",
  projectName: "P-1 · Skid",
  organizationName: "Acme",
  packageSha256: "ab".repeat(32),
  isConditional: false,
  conditionalReason: null,
  conditionalOpenItems: [],
  acknowledgedAt: null,
  receivedByName: null,
  receivedByCompany: null,
  acknowledgedOnBehalf: false,
  revision: "0",
  generatedAt: new Date("2026-10-07T10:00:00Z"),
};

describe("handover certificate template", () => {
  it("renders the certificate details and escapes user text", () => {
    const html = buildHandoverCertificateHtml(base);
    expect(html).toContain("HC-001");
    expect(html).toContain("HANDOVER ISSUED");
    expect(html).toContain("Final &lt;Data&gt; Book");
    expect(html).toContain("Awaiting the client");
  });

  it("shows conditions for a conditional handover", () => {
    const html = buildHandoverCertificateHtml({
      ...base,
      isConditional: true,
      conditionalReason: "Paint touch-up outstanding",
      conditionalOpenItems: [{ description: "Touch-up", responsible_party_name: "Subcon", due_date: "2026-10-20" }],
    });
    expect(html).toContain("CONDITIONAL HANDOVER");
    expect(html).toContain("Paint touch-up outstanding");
    expect(html).toContain("Touch-up");
  });

  it("shows who acknowledged and whether it was on behalf of the client", () => {
    const html = buildHandoverCertificateHtml({
      ...base,
      acknowledgedAt: "2026-10-08T09:30:00Z",
      receivedByName: "Cara Client",
      receivedByCompany: "Acme",
      acknowledgedOnBehalf: true,
    });
    expect(html).toContain("Cara Client");
    expect(html).toContain("on behalf of the client");
  });

  it("embeds the acknowledgement signature and evidence file name (S7-18)", () => {
    const html = buildHandoverCertificateHtml({
      ...base,
      acknowledgedAt: "2026-10-08T09:30:00Z",
      receivedByName: "Cara Client",
      acknowledgementSignatureDataUri: "data:image/png;base64,iVBORw0KGgo=",
      acknowledgementEvidenceName: "signed <letter>.pdf",
    });
    expect(html).toContain('<img src="data:image/png;base64,iVBORw0KGgo=" alt="Client signature" />');
    expect(html).toContain("signed &lt;letter&gt;.pdf");
  });

  it("never embeds a signature that is not a plain PNG/JPEG data URL", () => {
    expect(safeSignatureDataUri('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(safeSignatureDataUri('data:image/png;base64,AAAA" onerror="x')).toBeNull();
    expect(safeSignatureDataUri("javascript:alert(1)")).toBeNull();
    expect(safeSignatureDataUri("data:image/png;base64," + "A".repeat(700_000))).toBeNull();
    expect(safeSignatureDataUri("data:image/jpeg;base64,/9j/4AAQ")).toBe("data:image/jpeg;base64,/9j/4AAQ");
    const html = buildHandoverCertificateHtml({
      ...base,
      acknowledgedAt: "2026-10-08T09:30:00Z",
      acknowledgementSignatureDataUri: 'data:image/png;base64,AAAA" onerror="x',
    });
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("Client signature");
  });
});
