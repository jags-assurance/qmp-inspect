import { describe, it, expect } from "vitest";
import { computeScaledSize, isResizableImageType, shouldUseDownscaled, createPhotoDownscaler, REPORT_PHOTO_MAX_EDGE } from "../src/jobs/photoDownscale";

describe("report photo downscaling (S6-07)", () => {
  it("fits the longest edge into the cap, keeping the aspect ratio", () => {
    expect(computeScaledSize(4000, 3000)).toEqual({ width: REPORT_PHOTO_MAX_EDGE, height: 1200 });
    expect(computeScaledSize(3000, 4000)).toEqual({ width: 1200, height: REPORT_PHOTO_MAX_EDGE });
  });
  it("never upscales", () => {
    expect(computeScaledSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(computeScaledSize(REPORT_PHOTO_MAX_EDGE, 10)).toEqual({ width: REPORT_PHOTO_MAX_EDGE, height: 10 });
  });
  it("keeps a minimum of one pixel and tolerates bad input", () => {
    expect(computeScaledSize(100000, 1).height).toBe(1);
    expect(computeScaledSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
  it("only replaces the original when the copy is smaller", () => {
    expect(shouldUseDownscaled(1000, 400)).toBe(true);
    expect(shouldUseDownscaled(1000, 1000)).toBe(false);
    expect(shouldUseDownscaled(1000, 0)).toBe(false);
  });
  it("resizes only raster photo types", () => {
    expect(isResizableImageType("image/jpeg")).toBe(true);
    expect(isResizableImageType("IMAGE/PNG")).toBe(true);
    expect(isResizableImageType("image/svg+xml")).toBe(false);
    expect(isResizableImageType("application/pdf")).toBe(false);
  });
  it("embeds small images and unsupported types untouched without opening a browser", async () => {
    const d = createPhotoDownscaler();
    const small = Buffer.from("tiny");
    const out = await d.downscale(small, "image/jpeg");
    expect(out.resized).toBe(false);
    expect(out.dataUri).toBe(`data:image/jpeg;base64,${small.toString("base64")}`);
    const big = Buffer.alloc(400 * 1024, 1);
    const svg = await d.downscale(big, "image/svg+xml");
    expect(svg.resized).toBe(false);
    await d.close();
  });
});
