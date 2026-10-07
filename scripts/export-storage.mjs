#!/usr/bin/env node
// F-06: export (back up) the Supabase Storage buckets to a local folder.
//
// A Supabase database backup / PITR restore does NOT include Storage objects, so the rendered PDFs,
// inspection evidence (photos, documents, vault uploads) and org logos need their own periodic copy.
// This script copies every object of the chosen buckets to disk, writes a manifest with a SHA-256 and
// size per object, resumes an interrupted run, and exits non-zero if anything failed.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/export-storage.mjs --out /backups/jags/2026-11-11
//
// Options:
//   --out <dir>          destination (default ./storage-backup-<UTC timestamp>)
//   --buckets a,b        buckets to export (default: generated-documents, inspection-evidence, org-branding)
//   --since <ISO date>   incremental: only objects changed at or after this time
//   --concurrency <n>    parallel downloads, 1-16 (default 4)
//   --dry-run            list what would be copied (count and size); download nothing
//   --no-verify          skip the downloaded-size check against the listing
//   --help
//
// Needs Node 18+ (global fetch), no npm dependencies. The service role key is read from the environment
// only (never a flag, so it does not land in shell history or process listings) and is never printed.
// It is a read-only operation on Storage. See docs/OPERATIONS_RUNBOOK.md section 8 for scheduling,
// verification and restore.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DEFAULT_BUCKETS,
  canSkipDownload,
  changedSince,
  defaultOutDir,
  encodeObjectPath,
  formatBytes,
  parseArgs,
  safeLocalPath,
  splitListing,
  summarise,
} from "./lib/storage-export.mjs";

const PAGE = 1000;
const MAX_ATTEMPTS = 4;

const HELP = `Usage: node scripts/export-storage.mjs [--out dir] [--buckets a,b] [--since ISO] [--concurrency n] [--dry-run] [--no-verify]
Env:   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY`;

function fail(message) {
  console.error(`export-storage: ${message}`);
  process.exit(2);
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (err) {
  fail(`${err.message}\n${HELP}`);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!baseUrl || !serviceKey) fail("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");

const authHeaders = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** fetch with retry on network errors, 429 and 5xx (exponential backoff). Never logs headers. */
async function request(url, init = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { ...authHeaders, ...(init.headers ?? {}) } });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError;
}

async function listBuckets() {
  const res = await request(`${baseUrl}/storage/v1/bucket`);
  if (!res.ok) throw new Error(`listing buckets failed: HTTP ${res.status}`);
  return (await res.json()).map((b) => b.name);
}

/** Every file under a bucket, walking sub-folders; pages of 1000. */
async function listObjects(bucket) {
  const files = [];
  const queue = [""];
  while (queue.length > 0) {
    const prefix = queue.shift();
    for (let offset = 0; ; offset += PAGE) {
      const res = await request(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) throw new Error(`listing ${bucket}/${prefix} failed: HTTP ${res.status}`);
      const entries = await res.json();
      const split = splitListing(entries, prefix);
      queue.push(...split.folders);
      files.push(...split.files);
      if (entries.length < PAGE) break;
    }
  }
  return files;
}

async function localSize(file) {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}

async function downloadOne(bucket, file) {
  const dest = safeLocalPath(opts.out, bucket, file.path);
  if (!dest) return { bucket, path: file.path, status: "failed", size: 0, error: "unsafe object path, not written" };

  if (canSkipDownload(await localSize(dest), file.size)) {
    return { bucket, path: file.path, status: "skipped", size: file.size, updatedAt: file.updatedAt, sha256: null };
  }

  const url = `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(file.path)}`;
  const tmp = `${dest}.part`;
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    const res = await request(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk);
        bytes += chunk.length;
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(tmp));
    if (opts.verify && file.size > 0 && bytes !== file.size) {
      throw new Error(`size mismatch: listing says ${file.size} bytes, received ${bytes}`);
    }
    await rename(tmp, dest);
    return { bucket, path: file.path, status: "downloaded", size: bytes, updatedAt: file.updatedAt, sha256: hash.digest("hex") };
  } catch (err) {
    await rm(tmp, { force: true });
    return { bucket, path: file.path, status: "failed", size: 0, error: String(err.message ?? err) };
  }
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

async function main() {
  const available = await listBuckets();
  const wanted = opts.buckets ?? DEFAULT_BUCKETS;
  const missing = wanted.filter((b) => !available.includes(b));
  if (missing.length > 0) {
    // A missing default bucket is a warning (it may simply not exist in this project yet); a bucket the
    // operator named explicitly that does not exist is an error.
    if (opts.buckets) fail(`bucket(s) not found: ${missing.join(", ")}. Available: ${available.join(", ")}`);
    console.warn(`export-storage: skipping buckets that do not exist here: ${missing.join(", ")}`);
  }
  const buckets = wanted.filter((b) => available.includes(b));

  if (!opts.out) opts.out = defaultOutDir();
  opts.out = path.resolve(opts.out);

  const startedAt = new Date().toISOString();
  const all = [];
  for (const bucket of buckets) {
    process.stdout.write(`Listing ${bucket} ... `);
    const objects = (await listObjects(bucket)).filter((f) => changedSince(f, opts.since));
    const total = objects.reduce((n, f) => n + f.size, 0);
    console.log(`${objects.length} object(s), ${formatBytes(total)}`);
    if (opts.dryRun) {
      all.push(...objects.map((f) => ({ bucket, path: f.path, status: "skipped", size: f.size })));
      continue;
    }
    let done = 0;
    const results = await mapLimit(objects, opts.concurrency, async (file) => {
      const result = await downloadOne(bucket, file);
      done += 1;
      if (result.status === "failed") console.error(`  FAILED ${bucket}/${file.path}: ${result.error}`);
      else if (done % 200 === 0) console.log(`  ${bucket}: ${done}/${objects.length}`);
      return result;
    });
    all.push(...results);
  }

  const summary = summarise(all);
  if (opts.dryRun) {
    console.log(`Dry run: ${summary.objects} object(s), ${formatBytes(summary.bytes)} would be copied to ${opts.out}.`);
    return;
  }

  await mkdir(opts.out, { recursive: true });
  const manifest = {
    startedAt,
    finishedAt: new Date().toISOString(),
    source: new URL(baseUrl).host,
    since: opts.since,
    buckets,
    summary,
    objects: all.map(({ bucket, path: p, status, size, sha256, updatedAt, error }) => ({ bucket, path: p, status, size, sha256, updatedAt, ...(error ? { error } : {}) })),
  };
  const manifestFile = path.join(opts.out, `manifest-${startedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`);
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));

  console.log(
    `Done: ${summary.downloaded} downloaded, ${summary.skipped} already present, ${summary.failed} failed; ` +
      `${formatBytes(summary.bytes)} in ${opts.out}. Manifest: ${manifestFile}`
  );
  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`export-storage: ${err.message ?? err}`);
  process.exit(1);
});
