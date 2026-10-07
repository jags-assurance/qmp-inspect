import { describe, expect, it } from "vitest";
import { isHeicLike, stillUndecodableHeic } from "../heic";

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
