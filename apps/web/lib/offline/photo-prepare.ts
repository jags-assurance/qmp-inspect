"use client";

import { compressImageFile } from "@/lib/media/compress-image";

/**
 * Largest photo that may sit in the offline queue. Replays go through ONE Route Handler on a
 * serverless host whose request body cap is about 4.5 MB, so an oversized photo would be answered
 * with a bare platform 413 and never sync. Everything queued is therefore squeezed under this.
 */
export const OFFLINE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

async function reencode(file: File, maxEdge: number, quality: number): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return null;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return null;
  }
}

/**
 * Compresses a photo for the offline queue and guarantees (when the browser can decode it) that it
 * is at most OFFLINE_PHOTO_MAX_BYTES. Returns `tooLarge: true` when it still cannot be made small
 * enough, so the caller can refuse to queue something that could never sync.
 */
export async function prepareOfflinePhoto(raw: File): Promise<{ file: File; tooLarge: boolean }> {
  let file = await compressImageFile(raw);
  if (file.size <= OFFLINE_PHOTO_MAX_BYTES) return { file, tooLarge: false };
  for (const [edge, quality] of [
    [1280, 0.65],
    [1024, 0.55],
    [800, 0.5],
  ] as const) {
    const next = await reencode(file, edge, quality);
    if (next && next.size < file.size) file = next;
    if (file.size <= OFFLINE_PHOTO_MAX_BYTES) return { file, tooLarge: false };
  }
  return { file, tooLarge: file.size > OFFLINE_PHOTO_MAX_BYTES };
}
