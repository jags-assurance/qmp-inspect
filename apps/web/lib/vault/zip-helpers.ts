// Pure helpers for the vault "download all" zip (unit tested).

/**
 * One zip path segment: strips path separators, control characters and leading dots (a folder or file
 * named ".." would otherwise produce "../file" - zip-slip when extracted by a naive tool) and keeps it short.
 */
export function sanitizeZipSegment(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();
  return (cleaned || "file").slice(0, 150);
}

export interface ManifestRow {
  path: string;
  title: string;
  documentNumber: string | null;
  revision: string;
  status: string;
  sizeBytes: number;
  sha256: string;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** MANIFEST.csv content: one row per file in the zip with its SHA-256. */
export function buildManifestCsv(rows: ManifestRow[]): string {
  const header = ["path", "title", "document_number", "revision", "status", "size_bytes", "sha256"].join(",");
  const lines = rows.map((r) => [r.path, r.title, r.documentNumber, r.revision, r.status, r.sizeBytes, r.sha256].map(csvCell).join(","));
  return `${[header, ...lines].join("\r\n")}\r\n`;
}
