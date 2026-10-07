// Pure validation for document-numbering settings. These values end up in document numbers, file
// names and storage keys, so they are restricted to a safe character set.

const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,15}$/;
const ALLOWED_SEPARATORS = ["-", "_", ".", "/"] as const;

export function normaliseCode(value: string): string {
  return value.trim().toUpperCase();
}

export function validateCode(label: string, value: string): string | null {
  if (!CODE_RE.test(value)) {
    return `${label} may only contain letters, digits, "-", "_" and "." (max 16 characters).`;
  }
  return null;
}

/** "/" is not allowed: it would split storage paths and file names. */
export function validateSeparator(value: string): string | null {
  if (value === "/" || !(ALLOWED_SEPARATORS as readonly string[]).includes(value)) {
    return 'Separator must be one of "-", "_" or ".".';
  }
  return null;
}

/** Makes a document number safe to embed in a storage key or file name. */
export function slugifyForStorage(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_").slice(0, 120) || "document";
}

/** Previews the next number of a format, e.g. "JAGS-ACME-ITP-2026-001". */
export function previewNumber(parts: {
  originator: string;
  clientCode: string;
  docCode: string;
  separator: string;
  padding: number;
  includeYear: boolean;
  next?: number;
  year?: number;
}): string {
  const seq = String(parts.next ?? 1).padStart(parts.padding, "0");
  const segs = [parts.originator, parts.clientCode, parts.docCode];
  if (parts.includeYear) segs.push(String(parts.year ?? new Date().getUTCFullYear()));
  segs.push(seq);
  return segs.join(parts.separator);
}
