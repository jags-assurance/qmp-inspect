"use client";

// Round-table performance finding: evidence photos from a phone camera (commonly 3-12MB, 4000px+)
// were uploaded and stored completely unmodified, then served at that same full resolution for a
// thumbnail that renders at card size — a real cost on both ends (Storage size, and upload time on
// the field connections this app is explicitly built for). This downscales + re-encodes on the
// client, before the bytes ever leave the device, using the Canvas API (no new dependency — the
// surface area needed doesn't justify one).

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

/**
 * Downscales an image file to at most MAX_DIMENSION on its long edge and re-encodes it as JPEG.
 * Returns the original file unchanged if it isn't an image, is already small, or compression fails
 * for any reason (corrupt image, browser API unavailable) — this must never block a real upload
 * over an optimization.
 */
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));

    // Already small enough, and not something we'd shrink further — leave it as-is rather than
    // re-encoding (a re-encode of an already-optimized small image can occasionally grow it).
    if (scale === 1 && file.size < 500_000) {
      bitmap.close();
      return file;
    }

    const targetWidth = Math.round(bitmap.width * scale);
    const targetHeight = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) return file;

    // Only use the compressed result if it's actually smaller — a tiny or already-compressed
    // source image re-encoded as JPEG can sometimes come out larger.
    if (blob.size >= file.size) return file;

    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
