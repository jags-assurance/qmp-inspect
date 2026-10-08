// Pure helpers for the orphan-photo review screen (flags come from the worker; see migration
// 20261113000400_orphan_photo_flags.sql). Nothing here touches Storage or the database.

export const ORPHAN_BUCKET = "inspection-evidence";
export const REMOVE_CONFIRMATION = "REMOVE FILE";

export type OrphanDecision = "kept" | "removed";

export function isOrphanDecision(value: string): value is OrphanDecision {
  return value === "kept" || value === "removed";
}

/** The typed confirmation for deleting the stored file. Case-insensitive, surrounding spaces ignored. */
export function isRemoveConfirmed(typed: string | null | undefined): boolean {
  return (typed ?? "").trim().toUpperCase() === REMOVE_CONFIRMATION;
}

export function fileNameOf(storagePath: string): string {
  const parts = storagePath.split("/");
  return parts[parts.length - 1] || storagePath;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|avif)$/i;

export function isImagePath(storagePath: string): boolean {
  return IMAGE_EXT.test(storagePath);
}

/**
 * Storage paths in this bucket are <project_id>/<inspection_record_id>/<file>. Only such a path may be
 * deleted from this screen, so a tampered form value can never point at some other object.
 */
export function isOrphanCandidatePath(storagePath: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/]+$/i.test(storagePath);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function decisionNote(decision: OrphanDecision, note: string, removedFile: boolean): string {
  const base = removedFile ? "File deleted from storage by an Admin." : decision === "removed" ? "Recorded as removed by hand." : "Kept.";
  const extra = note.trim();
  return extra ? `${base} ${extra}`.slice(0, 500) : base;
}
