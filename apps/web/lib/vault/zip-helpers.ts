// Pure helpers for the vault "download all" zip (unit tested).

import { parseFilingPath } from "@/lib/checklists/attempts";

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

/**
 * Directory of a zip entry: the vault category, then (for auto-filed generated records) the deterministic
 * filing path below the project - discipline / ITP / activity (lib/checklists/attempts.ts). The leading
 * project segment is dropped because the zip is already one project. Without a filing path it is just the
 * category folder, exactly as before.
 */
export function buildZipEntryDir(folderName: string, filingPath: string | null | undefined): string {
  const segments = parseFilingPath(filingPath).slice(1).map(sanitizeZipSegment);
  return [sanitizeZipSegment(folderName), ...segments].join("/");
}
