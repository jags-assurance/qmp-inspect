import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256Stream, sha256HexOfBlob } from "../sha256-stream";

const ref = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("Sha256Stream", () => {
  it("matches node:crypto for empty, short and block-boundary inputs", () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const data = new Uint8Array(randomBytes(len));
      expect(new Sha256Stream().update(data).digestHex()).toBe(ref(data));
    }
  });

  it("is chunk-size independent", () => {
    const data = new Uint8Array(randomBytes(10_000));
    const s = new Sha256Stream();
    for (let i = 0; i < data.length; i += 777) s.update(data.subarray(i, i + 777));
    expect(s.digestHex()).toBe(ref(data));
  });

  it("hashes a Blob in slices with progress", async () => {
    const data = new Uint8Array(randomBytes(50_000));
    const seen: number[] = [];
    const hex = await sha256HexOfBlob(new Blob([data]), (f) => seen.push(f), 8_192);
    expect(hex).toBe(ref(data));
    expect(seen[seen.length - 1]).toBe(1);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("refuses updates after the digest", () => {
    const s = new Sha256Stream();
    s.digestHex();
    expect(() => s.update(new Uint8Array(1))).toThrow();
  });
});
