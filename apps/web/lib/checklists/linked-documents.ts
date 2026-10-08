/**
 * Pure helpers for the documents linked to checklist items (inspection_evidence_documents rows with
 * a checklist_item_id), shown on the inspection record page. The worker's inspection report
 * (worker/src/jobs/inspectionReportTemplate.ts) has its own matching shape; keep them in step.
 */
export interface LinkedDocumentRow {
  id: string;
  vault_document_id: string;
  checklist_item_id: string | null;
  vault_documents: { title: string; document_reference: string | null; status: string } | null;
}

export interface LinkedDocumentView {
  linkId: string;
  vaultDocumentId: string;
  title: string;
  reference: string | null;
  status: string;
  statusLabel: string;
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

/** Groups item-linked document rows by checklist item id (whole-inspection links, with no item, are skipped). */
export function groupLinkedDocumentsByItem(rows: LinkedDocumentRow[]): Map<string, LinkedDocumentView[]> {
  const out = new Map<string, LinkedDocumentView[]>();
  for (const r of rows) {
    if (!r.checklist_item_id) continue;
    const status = r.vault_documents?.status ?? "for_review";
    const list = out.get(r.checklist_item_id) ?? [];
    list.push({
      linkId: r.id,
      vaultDocumentId: r.vault_document_id,
      title: r.vault_documents?.title?.trim() || "Untitled document",
      reference: r.vault_documents?.document_reference?.trim() || null,
      status,
      statusLabel: linkedDocumentStatusLabel(status),
    });
    out.set(r.checklist_item_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}
