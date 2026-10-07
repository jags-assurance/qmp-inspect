import { describe, expect, it } from "vitest";
import { groupLinkedDocumentsByItem, linkedDocumentStatusLabel } from "../linked-documents";

describe("linkedDocumentStatusLabel", () => {
  it("maps known statuses and defaults to pending", () => {
    expect(linkedDocumentStatusLabel("approved")).toBe("Approved");
    expect(linkedDocumentStatusLabel("rejected")).toBe("Rejected");
    expect(linkedDocumentStatusLabel("for_review")).toBe("Pending vault approval");
    expect(linkedDocumentStatusLabel(null)).toBe("Pending vault approval");
  });
});

describe("groupLinkedDocumentsByItem", () => {
  it("groups by item, skips whole-inspection links, sorts by title and tolerates a missing vault row", () => {
    const m = groupLinkedDocumentsByItem([
      { id: "l1", vault_document_id: "d1", checklist_item_id: "i1", vault_documents: { title: "Zeta", document_reference: "R-1", status: "approved" } },
      { id: "l2", vault_document_id: "d2", checklist_item_id: "i1", vault_documents: { title: "Alpha", document_reference: " ", status: "for_review" } },
      { id: "l3", vault_document_id: "d3", checklist_item_id: null, vault_documents: { title: "Whole", document_reference: null, status: "approved" } },
      { id: "l4", vault_document_id: "d4", checklist_item_id: "i2", vault_documents: null },
    ]);
    expect([...m.keys()]).toEqual(["i1", "i2"]);
    expect(m.get("i1")!.map((d) => d.title)).toEqual(["Alpha", "Zeta"]);
    expect(m.get("i1")![0].reference).toBeNull();
    expect(m.get("i1")![1].reference).toBe("R-1");
    expect(m.get("i2")![0]).toMatchObject({ title: "Untitled document", status: "for_review" });
  });
});
