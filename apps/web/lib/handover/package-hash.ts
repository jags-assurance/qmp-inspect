// S7-10: server-side re-hash of the handover package. The browser computes the package SHA-256 before
// upload, but a certificate must not rest on a client-supplied fingerprint: before issuing, the server
// streams the stored object back out of Storage, hashes the bytes it actually holds, and compares.
// Kept free of "use server" so the pure parts unit-test cleanly.

import { createHash } from "node:crypto";

/** Packages above this size are refused rather than hashed (a runaway stream must not tie up the action). */
export const MAX_VERIFY_BYTES = 1024 * 1024 * 1024;

export interface HashResult {
  sha256: string;
  bytes: number;
}

/** Streaming SHA-256 over any async byte source (a fetch body, a Node stream, a test array). */
export async function sha256OfChunks(chunks: AsyncIterable<Uint8Array>, maxBytes: number = MAX_VERIFY_BYTES): Promise<HashResult> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of chunks) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new PackageTooLargeError(maxBytes);
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}

export class PackageTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Package is larger than ${Math.round(maxBytes / 1024 / 1024)} MB and cannot be verified`);
    this.name = "PackageTooLargeError";
  }
}

export type PackageVerification =
  | { ok: true; sha256: string; bytes: number }
  | { ok: false; reason: "mismatch" | "empty" | "too_large" | "unreadable"; message: string };

/** Compares a server-computed hash with the one the browser reported. */
export function comparePackageHash(claimedSha256: string, computed: HashResult): PackageVerification {
  if (computed.bytes === 0) {
    return { ok: false, reason: "empty", message: "The uploaded package file is empty. Upload it again." };
  }
  if (computed.sha256 !== claimedSha256.trim().toLowerCase()) {
    return {
      ok: false,
      reason: "mismatch",
      message: "The uploaded package does not match its fingerprint (it may have been altered or truncated during upload). Re-upload the file and try again.",
    };
  }
  return { ok: true, sha256: computed.sha256, bytes: computed.bytes };
}

/** Minimal slice of the Supabase client this needs, so tests can fake it. */
export interface SignedUrlClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;

/**
 * Re-hashes the stored package and checks it against the browser's claim. Never throws: any failure to
 * read the object comes back as `unreadable` (the caller fails closed and asks the user to retry).
 */
export async function verifyStoredPackageHash(
  client: SignedUrlClient,
  bucket: string,
  path: string,
  claimedSha256: string,
  fetchImpl: FetchLike = (url) => fetch(url) as unknown as ReturnType<FetchLike>
): Promise<PackageVerification> {
  try {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      return { ok: false, reason: "unreadable", message: "Could not read the uploaded package back from storage to verify it. Try again." };
    }
    const res = await fetchImpl(data.signedUrl);
    if (!res.ok || !res.body) {
      return { ok: false, reason: "unreadable", message: "Could not read the uploaded package back from storage to verify it. Try again." };
    }
    const computed = await sha256OfChunks(res.body as unknown as AsyncIterable<Uint8Array>);
    return comparePackageHash(claimedSha256, computed);
  } catch (err) {
    if (err instanceof PackageTooLargeError) {
      return { ok: false, reason: "too_large", message: "The package is too large to verify on the server. Split it or reduce its size." };
    }
    console.error("[handover] package re-hash failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "unreadable", message: "Could not verify the uploaded package right now. Nothing was issued; try again." };
  }
}
