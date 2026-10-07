import { describe, it, expect } from "vitest";
import { buildLinkedDocumentRows, linkedDocumentStatusLabel, vaultDocumentUrl } from "../src/jobs/linkedDocuments";
import { renderLinkedDocuments } from "../src/jobs/inspectionReportTemplate";

describe("vaultDocumentUrl", () => {
  it("builds an absolute link only for an http(s) base", () => {
    expect(vaultDocumentUrl("https://app.example.com/", "p1", "d1")).toBe("https://app.example.com/inspect/vault/p1/document/d1");
    expect(vaultDocumentUrl(undefined, "p1", "d1")).toBeNull();
    expect(vaultDocumentUrl("javascript:alert(1)", "p1", "d1")).toBeNull();
  });
});

describe("buildLinkedDocumentRows", () => {
  const items = new Map([
    ["i2", "2"],
    ["i10", "10"],
  ]);
  it("skips whole-inspection links, orders by item number numerically and labels status", () => {
    const rows = buildLinkedDocumentRows(
      [
        { vault_document_id: "d1", checklist_item_id: "i10", vault_documents: { title: "Cert", document_reference: "C-1", status: "approved" } },
        { vault_document_id: "d2", checklist_item_id: "i2", vault_documents: { title: "Drawing", document_reference: null, status: "for_review" } },
        { vault_document_id: "d3", checklist_item_id: null, vault_documents: { title: "Whole", document_reference: null, status: "approved" } },
      ],
      items,
      "p1",
      "https://app.example.com"
    );
    expect(rows.map((r) => r.itemNumber)).toEqual(["2", "10"]);
    expect(rows[0]).toMatchObject({ title: "Drawing", statusLabel: "Pending vault approval", reference: null });
    expect(rows[1].url).toBe("https://app.example.com/inspect/vault/p1/document/d1");
  });
  it("labels statuses", () => {
    expect(linkedDocumentStatusLabel("approved")).toBe("Approved");
    expect(linkedDocumentStatusLabel("rejected")).toBe("Rejected");
  });
});

describe("renderLinkedDocuments", () => {
  it("renders nothing when empty", () => {
    expect(renderLinkedDocuments(undefined)).toBe("");
    expect(renderLinkedDocuments([])).toBe("");
  });
  it("escapes titles and renders link + reference", () => {
    const html = renderLinkedDocuments([
      { itemNumber: "1", title: "<b>x</b>", reference: "REF&1", statusLabel: "Approved", url: "https://a.test/d" },
      { itemNumber: "2", title: "No link", reference: null, statusLabel: "Pending vault approval", url: null },
    ]);
    expect(html).toContain("Linked documents");
    expect(html).toContain('<a href="https://a.test/d">&lt;b&gt;x&lt;/b&gt;</a>');
    expect(html).toContain("REF&amp;1");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("<td>No link</td>");
  });
});
