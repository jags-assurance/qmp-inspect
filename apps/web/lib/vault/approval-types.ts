// vault_document_approvers isn't in the generated Database type yet — same documented escape hatch
// as VAULT_FOLDERS_TABLE/VAULT_DOCUMENTS_TABLE.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const VAULT_DOCUMENT_APPROVERS_TABLE = "vault_document_approvers" as any;

export interface VaultDocumentApproverRow {
  id: string;
  document_id: string;
  approver_user_id: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at: string | null;
}
