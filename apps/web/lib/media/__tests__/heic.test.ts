import { describe, expect, it } from "vitest";
import { hasHeicSignature, isHeicFile, isHeicLike, stillUndecodableHeic } from "../heic";

describe("isHeicLike", () => {
  it("matches by mime type or extension", () => {
    expect(isHeicLike({ name: "a.jpg", type: "image/heic" })).toBe(true);
    expect(isHeicLike({ name: "IMG_1.HEIC", type: "" })).toBe(true);
    expect(isHeicLike({ name: "a.heif", type: "application/octet-stream" })).toBe(true);
    expect(isHeicLike({ name: "a.jpg", type: "image/jpeg" })).toBe(false);
  });
});

describe("stillUndecodableHeic", () => {
  it("is true only when the processed file is still HEIC", () => {
    const heic = { name: "a.heic", type: "image/heic" };
    expect(stillUndecodableHeic(heic, heic)).toBe(true);
    expect(stillUndecodableHeic(heic, { name: "a.jpg", type: "image/jpeg" })).toBe(false);
    expect(stillUndecodableHeic({ name: "a.jpg", type: "image/jpeg" }, { name: "a.jpg", type: "image/jpeg" })).toBe(false);
  });
});

function ftyp(major: string, compatible: string[] = []): Uint8Array<ArrayBuffer> {
  const brands = [major, "\0\0\0\0", ...compatible].join("");
  const size = 8 + brands.length;
  const bytes = new Uint8Array(size + 8);
  bytes.set([0, 0, 0, size], 0);
  bytes.set(new TextEncoder().encode("ftyp" + brands), 4);
  return bytes;
}

describe("hasHeicSignature", () => {
  it("accepts HEIC major or compatible brands", () => {
    expect(hasHeicSignature(ftyp("heic"))).toBe(true);
    expect(hasHeicSignature(ftyp("mif1", ["miaf", "heix"]))).toBe(true);
  });
  it("rejects AVIF, JPEG and short buffers", () => {
    expect(hasHeicSignature(ftyp("avif", ["mif1", "miaf"]))).toBe(false);
    expect(hasHeicSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(false);
    expect(hasHeicSignature(new Uint8Array(4))).toBe(false);
  });
});

describe("isHeicFile", () => {
  it("detects a HEIC whose name and MIME were lost", async () => {
    const file = new File([ftyp("heic")], "IMG_0001.jpg", { type: "image/jpeg" });
    expect(await isHeicFile(file)).toBe(true);
    expect(await isHeicFile(new File([ftyp("heic")], "photo", { type: "" }))).toBe(true);
  });
  it("trusts MIME/extension without reading bytes and ignores other types", async () => {
    expect(await isHeicFile(new File(["x"], "a.heic", { type: "" }))).toBe(true);
    expect(await isHeicFile(new File([ftyp("heic")], "a.pdf", { type: "application/pdf" }))).toBe(false);
    expect(await isHeicFile(new File(["plain jpeg"], "a.jpg", { type: "image/jpeg" }))).toBe(false);
  });
});
