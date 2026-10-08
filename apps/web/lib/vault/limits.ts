// Vault upload size cap, shared by the upload form (client) and uploadVaultDocumentCore (server).
// Files above one 6 MB chunk go up through the resumable (TUS) path in lib/storage/resumable-upload.ts,
// so a dropped connection resumes instead of restarting. The Storage bucket / project limits must be at
// least this big too: see docs/OPERATIONS_RUNBOOK.md ("Large vault uploads") and migration
// 20261127000400_inspection_evidence_file_size_limit.sql.

export const VAULT_MAX_UPLOAD_MB = 500;
export const VAULT_MAX_UPLOAD_BYTES = VAULT_MAX_UPLOAD_MB * 1024 * 1024;

/** Above this the server does not download the file for text extraction (it stays stored, just not AI-readable). */
export const VAULT_EXTRACT_MAX_BYTES = 50 * 1024 * 1024;

export function vaultFileTooLargeMessage(sizeBytes?: number): string {
  const size = sizeBytes && sizeBytes > 0 ? ` (this file is ${Math.ceil(sizeBytes / (1024 * 1024))} MB)` : "";
  return `Files larger than ${VAULT_MAX_UPLOAD_MB} MB can't be stored in the vault${size}. Split or compress the file and try again.`;
}
