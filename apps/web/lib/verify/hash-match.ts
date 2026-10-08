// Pure logic for the public verification page's "check a file" box. The file is hashed in the browser
// (Web Crypto) and never uploaded; this only decides what the resulting hash means.

export type HashMatchKind = "pdf" | "data_book" | "package";

export interface KnownHashes {
  pdf_sha256s?: string[] | null;
  data_book_sha256?: string | null;
  package_sha256?: string | null;
}

export type HashMatch = { matched: true; kind: HashMatchKind } | { matched: false };

export function normaliseHash(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Does `fileHash` equal any fingerprint recorded for this document? Never matches an empty or malformed hash. */
export function matchFileHash(fileHash: string, known: KnownHashes): HashMatch {
  const h = normaliseHash(fileHash);
  if (!isSha256Hex(h)) return { matched: false };
  if ((known.pdf_sha256s ?? []).some((x) => normaliseHash(x) === h)) return { matched: true, kind: "pdf" };
  if (normaliseHash(known.data_book_sha256) === h) return { matched: true, kind: "data_book" };
  if (normaliseHash(known.package_sha256) === h) return { matched: true, kind: "package" };
  return { matched: false };
}

export const MATCH_LABEL: Record<HashMatchKind, string> = {
  pdf: "the PDF issued by the system",
  data_book: "the issued Data Book PDF",
  package: "the certified handover package",
};

/** Largest file the in-browser check will read into memory. */
export const MAX_CHECK_BYTES = 250 * 1024 * 1024;

export function hasAnyHash(known: KnownHashes): boolean {
  return (known.pdf_sha256s ?? []).length > 0 || !!known.data_book_sha256 || !!known.package_sha256;
}
