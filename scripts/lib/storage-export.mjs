// Pure helpers for scripts/export-storage.mjs (F-06). No I/O and no network here, so they are unit
// tested (worker/__tests__/storageExport.test.ts).

import path from "node:path";

export const DEFAULT_BUCKETS = ["generated-documents", "inspection-evidence", "org-branding"];

/**
 * Parses `--flag value` / `--flag=value` / boolean flags. Throws on an unknown flag so a typo
 * (`--bucket` for `--buckets`) cannot silently export the wrong thing.
 */
export function parseArgs(argv) {
  const opts = {
    out: null,
    buckets: null,
    since: null,
    concurrency: 4,
    dryRun: false,
    verify: true,
    help: false,
  };
  const known = new Set(["out", "buckets", "since", "concurrency", "dry-run", "no-verify", "help"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!known.has(name)) throw new Error(`Unknown option: --${name}`);
    const boolean = name === "dry-run" || name === "no-verify" || name === "help";
    let value = eq === -1 ? undefined : arg.slice(eq + 1);
    if (!boolean && value === undefined) {
      value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    }
    switch (name) {
      case "out":
        opts.out = value;
        break;
      case "buckets":
        opts.buckets = value
          .split(",")
          .map((b) => b.trim())
          .filter(Boolean);
        if (opts.buckets.length === 0) throw new Error("--buckets needs at least one bucket name");
        break;
      case "since": {
        if (Number.isNaN(Date.parse(value))) throw new Error(`--since must be an ISO date/time, got "${value}"`);
        opts.since = new Date(value).toISOString();
        break;
      }
      case "concurrency": {
        const n = Number.parseInt(value, 10);
        if (!Number.isInteger(n) || n < 1 || n > 16) throw new Error("--concurrency must be an integer from 1 to 16");
        opts.concurrency = n;
        break;
      }
      case "dry-run":
        opts.dryRun = true;
        break;
      case "no-verify":
        opts.verify = false;
        break;
      case "help":
        opts.help = true;
        break;
    }
  }
  return opts;
}

/** Timestamped default folder name, e.g. storage-backup-20261111T031500Z (UTC, filesystem-safe). */
export function defaultOutDir(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `storage-backup-${stamp}`;
}

/**
 * Maps a storage object path to a path inside `<outDir>/<bucket>/`. Returns null for anything that
 * could escape that folder (absolute path, `..`, empty or NUL-containing segments, backslashes): an
 * object key is user-influenced data, never trust it as a filesystem path.
 */
export function safeLocalPath(outDir, bucket, objectPath) {
  if (!bucket || /[\\/\0]/.test(bucket) || bucket === "." || bucket === "..") return null;
  if (!objectPath || objectPath.includes("\0") || objectPath.includes("\\")) return null;
  const segments = objectPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const root = path.resolve(outDir, bucket);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/** URL-encodes each segment of an object path (keeps the slashes). */
export function encodeObjectPath(objectPath) {
  return objectPath.split("/").map(encodeURIComponent).join("/");
}

/**
 * Splits one page of a Storage `list` response into sub-folders and files. Folders come back as
 * entries with a null `id` and no metadata.
 */
export function splitListing(entries, prefix) {
  const folders = [];
  const files = [];
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.name !== "string" || entry.name === "") continue;
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.id === undefined) {
      folders.push(full);
    } else {
      files.push({
        path: full,
        size: Number(entry.metadata?.size ?? 0),
        updatedAt: entry.updated_at ?? entry.created_at ?? null,
        etag: entry.metadata?.eTag ?? null,
      });
    }
  }
  return { folders, files };
}

/** Incremental filter: keep objects changed at or after `since` (an object with no timestamp is always kept). */
export function changedSince(file, since) {
  if (!since || !file.updatedAt) return true;
  return Date.parse(file.updatedAt) >= Date.parse(since);
}

/**
 * Whether a file already on disk (size in bytes, or null when absent) makes the download redundant.
 * Resumes an interrupted run: a complete file of the expected size is skipped; a partial one is redone.
 */
export function canSkipDownload(existingSize, expectedSize) {
  if (existingSize === null || existingSize === undefined) return false;
  if (!expectedSize) return false; // size unknown or zero: cheap to refetch, never trust
  return existingSize === expectedSize;
}

/** "1.5 MB" style size for the progress/summary lines. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** Totals for the end-of-run summary / manifest. */
export function summarise(results) {
  const summary = { objects: 0, bytes: 0, downloaded: 0, skipped: 0, failed: 0 };
  for (const r of results) {
    summary.objects += 1;
    if (r.status === "downloaded") {
      summary.downloaded += 1;
      summary.bytes += r.size;
    } else if (r.status === "skipped") {
      summary.skipped += 1;
      summary.bytes += r.size;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}
