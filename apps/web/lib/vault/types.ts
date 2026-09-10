// Domain types + table-name handles for `vault_folders` and `vault_documents`
// (supabase/migrations/20260910010000_phase2_document_vault.sql).
//
// Neither table is in the generated Database type yet, so `.from()` can't resolve them against the
// Tables map. Casting the table name is the one place that gap leaks in; every query still gets its
// real row shape back via an explicit `.returns<T>()` / typed `.single<T>()` — same pattern as
// apps/web/lib/ncrs/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const VAULT_FOLDERS_TABLE = "vault_folders" as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const VAULT_DOCUMENTS_TABLE = "vault_documents" as any;

export const VAULT_FOLDER_KEYS = [
  "drawings",
  "specifications",
  "standards_codes",
  "material_submittals",
  "rfis",
  "method_statements",
  "itps_approved",
  "checklists_forms",
  "approvals_correspondence",
  "certificates",
  "general_reference",
] as const;
export type VaultFolderKey = (typeof VAULT_FOLDER_KEYS)[number];

export const VAULT_DOCUMENT_STATUSES = ["for_review", "approved", "superseded"] as const;
export type VaultDocumentStatus = (typeof VAULT_DOCUMENT_STATUSES)[number];

export interface VaultFolderRow {
  id: string;
  project_id: string;
  folder_key: VaultFolderKey;
  name: string;
  created_at: string;
}

export interface VaultDocumentRow {
  id: string;
  folder_id: string;
  title: string;
  document_reference: string | null;
  revision: string;
  document_date: string | null;
  storage_path: string;
  file_size: number | null;
  notes: string | null;
  document_number: string | null;
  internal_reference: string | null;
  status: VaultDocumentStatus;
  superseded_by: string | null;
  uploaded_by: string | null;
  created_at: string;
}
