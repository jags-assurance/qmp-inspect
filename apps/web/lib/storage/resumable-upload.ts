// S7-21: resumable (TUS 1.0.0) uploads to Supabase Storage for large files, with no new dependency.
//
// Supabase Storage exposes a TUS endpoint at <project>/storage/v1/upload/resumable. A file is sent in
// 6 MB chunks (the size Supabase requires); if a chunk fails the client asks the server how many bytes
// it already has (HEAD) and carries on from there instead of starting again, which is what makes a
// 100 MB+ upload over a flaky site connection finish.
//
// Everything here is framework-free and takes fetch / sleep as parameters, so the protocol logic is
// unit-tested against an in-memory fake server (see __tests__/resumable-upload.test.ts). The browser
// wrapper that picks resumable vs the plain upload is in ./upload-client.ts.

export const TUS_VERSION = "1.0.0";
/** Supabase requires exactly 6 MB chunks (the last one may be shorter). */
export const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
/** Files at or below one chunk go through the ordinary single-request upload. */
export const RESUMABLE_THRESHOLD_BYTES = TUS_CHUNK_SIZE;
export const MAX_CHUNK_ATTEMPTS = 5;

/** Base64 of a UTF-8 string, in both the browser and Node (tests). */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** TUS `Upload-Metadata` header value: "key base64(value),key2 base64(value2)". */
export function encodeUploadMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k} ${base64Utf8(String(v))}`)
    .join(",");
}

/** The resumable endpoint for a Supabase project URL (an explicit override wins). */
export function resumableEndpoint(supabaseUrl: string, override?: string | null): string {
  const explicit = override?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/upload/resumable`;
}

/** Next byte range to send, or null once everything has been sent. `end` is exclusive. */
export function nextChunk(totalSize: number, offset: number, chunkSize = TUS_CHUNK_SIZE): { start: number; end: number } | null {
  if (offset < 0 || offset >= totalSize) return null;
  return { start: offset, end: Math.min(offset + chunkSize, totalSize) };
}

/** Whether a file is big enough, and the environment capable enough, for a resumable upload. */
export function shouldUseResumable(sizeBytes: number, opts: { hasAccessToken: boolean; hasFetch?: boolean } = { hasAccessToken: true }): boolean {
  if (!opts.hasAccessToken) return false;
  if (opts.hasFetch === false) return false;
  return sizeBytes > RESUMABLE_THRESHOLD_BYTES;
}

/** Delay before retry number `attempt` (1-based): 1s, 2s, 4s, 8s, capped at 15s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export interface ResumableUploadOptions {
  file: Blob;
  bucket: string;
  objectName: string;
  endpoint: string;
  accessToken: string;
  /** Supabase anon key; sent as the apikey header when present. */
  apiKey?: string | null;
  contentType?: string | null;
  upsert?: boolean;
  cacheControl?: string;
  chunkSize?: number;
  /** Fractional progress 0..1 after every accepted chunk. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

export type ResumableUploadResult =
  | { ok: true; /** How many times the client re-synced with the server after a failed chunk. */ resyncs: number }
  | { ok: false; aborted?: boolean; error: string; /** Bytes the server confirmed before the failure. */ uploadedBytes: number };

class TusStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function tusHeaders(opts: ResumableUploadOptions): Record<string, string> {
  const h: Record<string, string> = { "Tus-Resumable": TUS_VERSION, Authorization: `Bearer ${opts.accessToken}` };
  if (opts.apiKey) h.apikey = opts.apiKey;
  if (opts.upsert) h["x-upsert"] = "true";
  return h;
}

function parseOffset(res: Response): number {
  const raw = res.headers.get("Upload-Offset");
  const n = raw === null ? Number.NaN : Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new TusStatusError(res.status, "The server did not report an upload offset.");
  return n;
}

/**
 * Uploads `file` with TUS. Never throws for protocol or network failures: the caller gets
 * `{ ok: false }` and can fall back to the plain upload.
 *
 * Each chunk is retried (with backoff) up to `maxAttempts` times; between attempts the server is
 * asked for its current offset, so bytes it already accepted are never re-sent.
 */
export async function uploadResumable(opts: ResumableUploadOptions): Promise<ResumableUploadResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chunkSize = opts.chunkSize ?? TUS_CHUNK_SIZE;
  const maxAttempts = opts.maxAttempts ?? MAX_CHUNK_ATTEMPTS;
  const total = opts.file.size;
  let confirmed = 0;
  let resyncs = 0;

  const aborted = (): ResumableUploadResult => ({ ok: false, aborted: true, error: "Upload cancelled.", uploadedBytes: confirmed });

  try {
    // 1. Create the upload resource.
    const create = await doFetch(opts.endpoint, {
      method: "POST",
      headers: {
        ...tusHeaders(opts),
        "Upload-Length": String(total),
        "Upload-Metadata": encodeUploadMetadata({
          bucketName: opts.bucket,
          objectName: opts.objectName,
          contentType: opts.contentType || "application/octet-stream",
          cacheControl: opts.cacheControl ?? "3600",
        }),
      },
      signal: opts.signal,
    });
    if (create.status !== 201) throw new TusStatusError(create.status, `Could not start the resumable upload (HTTP ${create.status}).`);
    const location = create.headers.get("Location");
    if (!location) throw new TusStatusError(create.status, "The server did not return an upload location.");
    const uploadUrl = new URL(location, opts.endpoint).toString();

    // 2. Send chunks, resuming from the server's offset after any failure.
    let attempts = 0;
    while (confirmed < total) {
      if (opts.signal?.aborted) return aborted();
      const chunk = nextChunk(total, confirmed, chunkSize);
      if (!chunk) break;
      try {
        const res = await doFetch(uploadUrl, {
          method: "PATCH",
          headers: {
            ...tusHeaders(opts),
            "Content-Type": "application/offset+octet-stream",
            "Upload-Offset": String(chunk.start),
          },
          body: opts.file.slice(chunk.start, chunk.end),
          signal: opts.signal,
        });
        if (res.status !== 204 && res.status !== 200) throw new TusStatusError(res.status, `Chunk rejected (HTTP ${res.status}).`);
        confirmed = parseOffset(res);
        attempts = 0;
        opts.onProgress?.(total === 0 ? 1 : Math.min(1, confirmed / total));
      } catch (err) {
        if (opts.signal?.aborted) return aborted();
        attempts += 1;
        // Client errors other than "offset conflict / timeout" will not succeed on retry.
        const status = err instanceof TusStatusError ? err.status : 0;
        const retryable = status === 0 || status === 409 || status === 408 || status === 423 || status === 429 || status >= 500;
        if (!retryable || attempts >= maxAttempts) throw err;
        await sleep(retryDelayMs(attempts));
        resyncs += 1;
        // Ask the server what it actually has before re-sending anything.
        try {
          const head = await doFetch(uploadUrl, { method: "HEAD", headers: tusHeaders(opts), signal: opts.signal });
          if (head.status === 404 || head.status === 410) throw new TusStatusError(head.status, "The upload expired on the server.");
          if (head.ok) confirmed = Math.min(total, parseOffset(head));
        } catch (headErr) {
          if (headErr instanceof TusStatusError && (headErr.status === 404 || headErr.status === 410)) throw headErr;
          // The HEAD itself failed (still offline): the next loop iteration retries the chunk.
        }
      }
    }
    return { ok: true, resyncs };
  } catch (err) {
    if (opts.signal?.aborted) return aborted();
    return { ok: false, error: err instanceof Error ? err.message : "Resumable upload failed.", uploadedBytes: confirmed };
  }
}
