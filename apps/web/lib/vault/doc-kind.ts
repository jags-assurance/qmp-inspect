export type VaultDocTone = "neutral" | "danger" | "warning" | "info" | "gold" | "success";

export interface VaultDocKind {
  key: "itp" | "ncr" | "ncr_closeout" | "inspection_report" | "generated" | "upload";
  label: string;
  tone: VaultDocTone;
  /** True for documents the platform rendered (worker PDFs), false for human uploads. */
  generated: boolean;
}

export interface VaultFileType {
  key: "pdf" | "photo" | "other";
  label: string;
  tone: VaultDocTone;
}

const GENERATED_PREFIX = "generated-documents:";

/**
 * What a vault document IS, derived from data already on the row — so the list can colour-code
 * generated records (ITP / NCR / close-out certificate / inspection report) apart from uploads
 * without a schema change. Generated PDFs are the ones the worker filed under the
 * "generated-documents:" storage prefix (worker/src/jobs/vaultAutoFile.ts); their titles follow
 * fixed patterns set by each render job.
 */
export function vaultDocKind(row: { storagePath: string | null | undefined; title: string }): VaultDocKind {
  const generated = (row.storagePath ?? "").startsWith(GENERATED_PREFIX);
  if (!generated) return { key: "upload", label: "Uploaded", tone: "neutral", generated: false };
  const t = row.title;
  if (/^Inspection Report\b/i.test(t)) return { key: "inspection_report", label: "Inspection report", tone: "info", generated: true };
  if (/close-?out certificate/i.test(t)) return { key: "ncr_closeout", label: "NCR close-out", tone: "success", generated: true };
  if (/^NCR\b/i.test(t)) return { key: "ncr", label: "NCR", tone: "danger", generated: true };
  if (/\bITP\b/i.test(t)) return { key: "itp", label: "ITP", tone: "gold", generated: true };
  return { key: "generated", label: "Generated", tone: "gold", generated: true };
}

/** PDF / photo / other, from the stored file's extension (colour-coded in the list). */
export function vaultFileType(storagePath: string | null | undefined): VaultFileType {
  const ext = (storagePath ?? "").split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return { key: "pdf", label: "PDF", tone: "warning" };
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "tif", "tiff"].includes(ext)) return { key: "photo", label: "Photo", tone: "info" };
  return { key: "other", label: ext ? ext.toUpperCase() : "File", tone: "neutral" };
}
