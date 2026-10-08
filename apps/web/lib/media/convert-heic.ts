"use client";

import { HeicConversionError } from "./heic";

// heic-to bundles libheif (~3 MB), so it is imported only when a HEIC photo actually has to be
// converted. The "/csp" build is the asm.js one: it needs neither eval nor WebAssembly, so it runs
// under the enforced CSP (lib/security/headers.ts) without loosening it.
const CONVERT_QUALITY = 0.85;

/** Converts a HEIC/HEIF photo to a JPEG File in the browser; throws HeicConversionError on failure. */
export async function convertHeicToJpeg(file: File): Promise<File> {
  try {
    const { heicTo } = await import("heic-to/csp");
    const blob = await heicTo({ blob: file, type: "image/jpeg", quality: CONVERT_QUALITY });
    if (!blob || blob.size === 0) throw new HeicConversionError();
    return new File([blob], (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (err) {
    throw err instanceof HeicConversionError ? err : new HeicConversionError();
  }
}
