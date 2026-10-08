import { describe, expect, it } from "vitest";
import {
  RESUMABLE_THRESHOLD_BYTES,
  TUS_CHUNK_SIZE,
  encodeUploadMetadata,
  nextChunk,
  resumableEndpoint,
  retryDelayMs,
  shouldUseResumable,
  uploadResumable,
} from "../resumable-upload";

const ENDPOINT = "https://proj.supabase.co/storage/v1/upload/resumable";

/** In-memory TUS server. `failures` lets a test make specific requests fail. */
function fakeServer(opts: { failPatchAt?: number[]; createStatus?: number; dropResponseAt?: number[] } = {}) {
  const log: { method: string; offset?: string | null; size?: number }[] = [];
  let received = 0;
  let patchCount = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (method === "POST") {
      log.push({ method });
      const status = opts.createStatus ?? 201;
      return new Response(null, { status, headers: status === 201 ? { Location: "/storage/v1/upload/resumable/abc" } : {} });
    }
    if (method === "HEAD") {
      log.push({ method });
      return new Response(null, { status: 200, headers: { "Upload-Offset": String(received) } });
    }
    // PATCH
    patchCount += 1;
    const body = init?.body as Blob;
    log.push({ method, offset: headers["Upload-Offset"], size: body.size });
    if (opts.failPatchAt?.includes(patchCount)) throw new TypeError("network down");
    if (Number(headers["Upload-Offset"]) !== received) return new Response(null, { status: 409 });
    received += body.size;
    if (opts.dropResponseAt?.includes(patchCount)) throw new TypeError("response lost");
    return new Response(null, { status: 204, headers: { "Upload-Offset": String(received) } });
  }) as typeof fetch;
  return { fetchImpl, log, received: () => received };
}

const noSleep = async () => {};
const base = (file: Blob, extra: Partial<Parameters<typeof uploadResumable>[0]> = {}) => ({
  file,
  bucket: "inspection-evidence",
  objectName: "vault/p/f/1-a.pdf",
  endpoint: ENDPOINT,
  accessToken: "tok",
  sleep: noSleep,
  ...extra,
});

describe("helpers", () => {
  it("encodes TUS metadata as key + base64 value pairs", () => {
    expect(encodeUploadMetadata({ bucketName: "b", objectName: "a/é.pdf" })).toBe(
      `bucketName ${btoa("b")},objectName ${Buffer.from("a/é.pdf", "utf8").toString("base64")}`
    );
  });

  it("builds the resumable endpoint, honouring an override", () => {
    expect(resumableEndpoint("https://p.supabase.co/")).toBe("https://p.supabase.co/storage/v1/upload/resumable");
    expect(resumableEndpoint("https://p.supabase.co", "https://p.storage.supabase.co/storage/v1/upload/resumable/")).toBe(
      "https://p.storage.supabase.co/storage/v1/upload/resumable"
    );
  });

  it("splits a file into 6 MB chunks with a short last chunk", () => {
    const size = TUS_CHUNK_SIZE * 2 + 10;
    expect(nextChunk(size, 0)).toEqual({ start: 0, end: TUS_CHUNK_SIZE });
    expect(nextChunk(size, TUS_CHUNK_SIZE * 2)).toEqual({ start: TUS_CHUNK_SIZE * 2, end: size });
    expect(nextChunk(size, size)).toBeNull();
    expect(nextChunk(size, -1)).toBeNull();
  });

  it("only uses resumable for files above one chunk, with a token", () => {
    expect(shouldUseResumable(RESUMABLE_THRESHOLD_BYTES, { hasAccessToken: true })).toBe(false);
    expect(shouldUseResumable(RESUMABLE_THRESHOLD_BYTES + 1, { hasAccessToken: true })).toBe(true);
    expect(shouldUseResumable(50 * 1024 * 1024, { hasAccessToken: false })).toBe(false);
    expect(shouldUseResumable(50 * 1024 * 1024, { hasAccessToken: true, hasFetch: false })).toBe(false);
  });

  it("backs off exponentially up to a cap", () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
});

describe("uploadResumable", () => {
  it("uploads in chunks and reports progress", async () => {
    const server = fakeServer();
    const file = new Blob([new Uint8Array(25)]);
    const progress: number[] = [];
    const result = await uploadResumable(base(file, { fetchImpl: server.fetchImpl, chunkSize: 10, onProgress: (f) => progress.push(f) }));
    expect(result).toEqual({ ok: true, resyncs: 0 });
    expect(server.received()).toBe(25);
    expect(server.log.filter((l) => l.method === "PATCH").map((l) => [l.offset, l.size])).toEqual([
      ["0", 10],
      ["10", 10],
      ["20", 5],
    ]);
    expect(progress).toEqual([0.4, 0.8, 1]);
  });

  it("resumes from the server offset after a dropped connection instead of restarting", async () => {
    const server = fakeServer({ failPatchAt: [2] });
    const result = await uploadResumable(base(new Blob([new Uint8Array(30)]), { fetchImpl: server.fetchImpl, chunkSize: 10 }));
    expect(result).toEqual({ ok: true, resyncs: 1 });
    expect(server.received()).toBe(30);
    // Chunk 1 was sent once; chunk 2 failed once and was re-sent from the confirmed offset.
    expect(server.log.filter((l) => l.method === "PATCH" && l.offset === "0")).toHaveLength(1);
    expect(server.log.filter((l) => l.method === "HEAD")).toHaveLength(1);
  });

  it("does not re-send a chunk the server accepted but whose response was lost", async () => {
    const server = fakeServer({ dropResponseAt: [1] });
    const result = await uploadResumable(base(new Blob([new Uint8Array(20)]), { fetchImpl: server.fetchImpl, chunkSize: 10 }));
    expect(result.ok).toBe(true);
    expect(server.received()).toBe(20);
    expect(server.log.filter((l) => l.method === "PATCH" && l.offset === "0")).toHaveLength(1);
  });

  it("gives up after the attempt limit and reports bytes confirmed so far", async () => {
    const server = fakeServer({ failPatchAt: [2, 3, 4] });
    const result = await uploadResumable(base(new Blob([new Uint8Array(30)]), { fetchImpl: server.fetchImpl, chunkSize: 10, maxAttempts: 3 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.uploadedBytes).toBe(10);
  });

  it("fails fast (so the caller can fall back) when the endpoint refuses to create the upload", async () => {
    for (const status of [404, 403, 501]) {
      const server = fakeServer({ createStatus: status });
      const result = await uploadResumable(base(new Blob([new Uint8Array(30)]), { fetchImpl: server.fetchImpl, chunkSize: 10 }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(String(status));
        expect(result.uploadedBytes).toBe(0);
      }
      expect(server.log.filter((l) => l.method === "PATCH")).toHaveLength(0);
    }
  });

  it("returns a failure rather than throwing when the network is unreachable (CORS / offline)", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const result = await uploadResumable(base(new Blob([new Uint8Array(5)]), { fetchImpl }));
    expect(result.ok).toBe(false);
  });

  it("does not retry a non-retryable client error on a chunk", async () => {
    let patches = 0;
    const fetchImpl = (async (_u: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(null, { status: 201, headers: { Location: "https://x/up/1" } });
      patches += 1;
      return new Response(null, { status: 403 });
    }) as typeof fetch;
    const result = await uploadResumable(base(new Blob([new Uint8Array(20)]), { fetchImpl, chunkSize: 10 }));
    expect(result.ok).toBe(false);
    expect(patches).toBe(1);
  });

  it("stops quietly when aborted", async () => {
    const server = fakeServer();
    const controller = new AbortController();
    controller.abort();
    const result = await uploadResumable(base(new Blob([new Uint8Array(20)]), { fetchImpl: server.fetchImpl, chunkSize: 10, signal: controller.signal }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.aborted).toBe(true);
  });
});
