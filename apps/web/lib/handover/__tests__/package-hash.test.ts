import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { comparePackageHash, sha256OfChunks, verifyStoredPackageHash, type SignedUrlClient } from "../package-hash";

const bytes = (s: string) => new TextEncoder().encode(s);
const hex = (s: string) => createHash("sha256").update(s).digest("hex");

async function* chunked(...parts: string[]) {
  for (const p of parts) yield bytes(p);
}

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(bytes(p));
      controller.close();
    },
  });
}

function clientWith(signed: { signedUrl: string } | null, error: { message: string } | null = null): SignedUrlClient {
  return { storage: { from: () => ({ createSignedUrl: async () => ({ data: signed, error }) }) } };
}

describe("sha256OfChunks", () => {
  it("hashes across chunk boundaries like a single buffer", async () => {
    const out = await sha256OfChunks(chunked("hello ", "wor", "ld"));
    expect(out).toEqual({ sha256: hex("hello world"), bytes: 11 });
  });
  it("refuses an oversized stream", async () => {
    await expect(sha256OfChunks(chunked("aaaa", "bbbb"), 5)).rejects.toThrow(/cannot be verified/);
  });
});

describe("comparePackageHash", () => {
  it("accepts a matching hash (case-insensitive)", () => {
    const r = comparePackageHash(hex("x").toUpperCase(), { sha256: hex("x"), bytes: 1 });
    expect(r.ok).toBe(true);
  });
  it("rejects a mismatch and an empty file", () => {
    expect(comparePackageHash(hex("x"), { sha256: hex("y"), bytes: 1 })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(comparePackageHash(hex(""), { sha256: hex(""), bytes: 0 })).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("verifyStoredPackageHash", () => {
  it("verifies the bytes that storage returns", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body: streamOf("pack", "age") }));
    const r = await verifyStoredPackageHash(clientWith({ signedUrl: "https://x/y" }), "generated-documents", "handover/b/p.zip", hex("package"), fetchImpl);
    expect(r).toMatchObject({ ok: true, bytes: 7 });
    expect(fetchImpl).toHaveBeenCalledWith("https://x/y");
  });
  it("flags a file whose stored bytes differ from the claimed hash", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, body: streamOf("tampered") });
    const r = await verifyStoredPackageHash(clientWith({ signedUrl: "u" }), "b", "p", hex("package"), fetchImpl);
    expect(r).toMatchObject({ ok: false, reason: "mismatch" });
  });
  it("fails closed when the object cannot be read", async () => {
    expect(await verifyStoredPackageHash(clientWith(null, { message: "nope" }), "b", "p", hex("a"))).toMatchObject({ ok: false, reason: "unreadable" });
    const notOk = async () => ({ ok: false, status: 404, body: null });
    expect(await verifyStoredPackageHash(clientWith({ signedUrl: "u" }), "b", "p", hex("a"), notOk)).toMatchObject({ ok: false, reason: "unreadable" });
    const boom = async () => {
      throw new Error("network");
    };
    expect(await verifyStoredPackageHash(clientWith({ signedUrl: "u" }), "b", "p", hex("a"), boom)).toMatchObject({ ok: false, reason: "unreadable" });
  });
});
