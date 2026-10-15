// Vault upload size cap, shared by the upload form (client) and uploadVaultDocumentCore (server).
// Files above one 6 MB chunk go up through the resumable (TUS) path in lib/storage/resumable-upload.ts,
// so a dropped connection resumes instead of restarting. The Storage bucket / project limits must be at
// least this big too: see docs/OPERATIONS_RUNBOOK.md ("Large vault uploads") and migration
// 20261127000400_inspection_evidence_file_size_limit.sql.

/** Hard ceiling: the Storage bucket accepts nothing bigger, whatever an organisation sets. */
export const VAULT_MAX_UPLOAD_MB = 500;
export const VAULT_MAX_UPLOAD_BYTES = VAULT_MAX_UPLOAD_MB * 1024 * 1024;

/** What an organisation gets until a JAGS Admin changes it (Settings > Document Retention > Upload size limit). */
export const VAULT_DEFAULT_UPLOAD_MB = 50;
export const VAULT_UPLOAD_SETTINGS_TABLE = "org_vault_settings";

/** Validates a typed limit: a whole number of MB from 1 up to the 500 MB ceiling. */
export function parseVaultUploadLimitMb(raw: unknown): { ok: true; mb: number } | { ok: false; error: string } {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: `Enter a whole number of MB between 1 and ${VAULT_MAX_UPLOAD_MB}.` };
  const mb = Number(text);
  if (mb < 1 || mb > VAULT_MAX_UPLOAD_MB) return { ok: false, error: `The upload limit must be between 1 and ${VAULT_MAX_UPLOAD_MB} MB.` };
  return { ok: true, mb };
}

/** A stored or posted limit, clamped into the allowed range; anything unusable falls back to the default. */
export function effectiveVaultUploadLimitMb(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= VAULT_MAX_UPLOAD_MB ? n : VAULT_DEFAULT_UPLOAD_MB;
}

/** Above this the server does not download the file for text extraction (it stays stored, just not AI-readable). */
export const VAULT_EXTRACT_MAX_BYTES = 50 * 1024 * 1024;

export function vaultFileTooLargeMessage(sizeBytes?: number, limitMb: number = VAULT_MAX_UPLOAD_MB): string {
  const size = sizeBytes && sizeBytes > 0 ? ` (this file is ${Math.ceil(sizeBytes / (1024 * 1024))} MB)` : "";
  return `Files larger than ${limitMb} MB can't be stored in this project's vault${size}. Split or compress the file and try again${limitMb < VAULT_MAX_UPLOAD_MB ? ", or ask a JAGS Admin to raise the upload limit" : ""}.`;
}
