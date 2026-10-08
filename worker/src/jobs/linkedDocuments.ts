// Documents linked to checklist items (inspection_evidence_documents with a checklist_item_id), as
// listed in the Inspection Report. Pure so it can be unit-tested without Supabase.

export interface LinkedDocumentSourceRow {
  vault_document_id: string;
  checklist_item_id: string | null;
  vault_documents: { title: string; document_reference: string | null; status: string } | null;
}

export interface InspectionReportLinkedDocument {
  itemNumber: string;
  title: string;
  reference: string | null;
  statusLabel: string;
  /** Absolute link to the vault document, or null when no public app URL is configured. */
  url: string | null;
}

export function linkedDocumentStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "superseded":
      return "Superseded";
    default:
      return "Pending vault approval";
  }
}

export function vaultDocumentUrl(base: string | null | undefined, projectId: string, documentId: string): string | null {
  const root = (base ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(root)) return null;
  return `${root}/inspect/vault/${encodeURIComponent(projectId)}/document/${encodeURIComponent(documentId)}`;
}

/**
 * Builds report rows for item-linked documents, ordered by checklist item number (numeric-aware)
 * then title. Whole-inspection links (no checklist item) are not listed here.
 */
export function buildLinkedDocumentRows(
  rows: LinkedDocumentSourceRow[],
  itemNumberById: Map<string, string>,
  projectId: string,
  appUrl: string | null | undefined
): InspectionReportLinkedDocument[] {
  const out: InspectionReportLinkedDocument[] = [];
  for (const r of rows) {
    if (!r.checklist_item_id) continue;
    out.push({
      itemNumber: itemNumberById.get(r.checklist_item_id) ?? "",
      title: r.vault_documents?.title?.trim() || "Untitled document",
      reference: r.vault_documents?.document_reference?.trim() || null,
      statusLabel: linkedDocumentStatusLabel(r.vault_documents?.status),
      url: vaultDocumentUrl(appUrl, projectId, r.vault_document_id),
    });
  }
  return out.sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }) || a.title.localeCompare(b.title));
}
