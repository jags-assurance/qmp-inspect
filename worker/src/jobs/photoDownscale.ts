import type { Page } from "puppeteer";
import { getSharedBrowser } from "../browserPool";

/**
 * S6-07: downscale evidence photos before they are inlined into a PDF report.
 *
 * Phone originals are 3-8 MB; a report page shows a photo at well under 1000 px, so embedding the
 * original only bloats the HTML string, the render time and the final PDF. The worker has no image
 * library, so the resize runs in the already-running shared Chromium (canvas), on one blank page per
 * report. Every failure falls back to the ORIGINAL bytes (never a lost photo) and an image that does
 * not get smaller is kept as is.
 */

/** Longest edge, in pixels, of a photo embedded in a report. */
export const REPORT_PHOTO_MAX_EDGE = 1600;
/** JPEG quality used for the re-encode. */
export const REPORT_PHOTO_JPEG_QUALITY = 0.8;
/** Below this the original is already small; re-encoding would only lose quality. */
export const REPORT_PHOTO_SKIP_BELOW_BYTES = 250 * 1024;

const RESIZABLE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function isResizableImageType(contentType: string): boolean {
  return RESIZABLE_TYPES.has(contentType.toLowerCase());
}

/** Target size that fits within maxEdge on the longest side, never upscaling, keeping aspect ratio. */
export function computeScaledSize(width: number, height: number, maxEdge: number = REPORT_PHOTO_MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: Math.max(0, width), height: Math.max(0, height) };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Whether a re-encoded image should replace the original (only when it is actually smaller). */
export function shouldUseDownscaled(originalBytes: number, downscaledBytes: number): boolean {
  return downscaledBytes > 0 && downscaledBytes < originalBytes;
}

export interface DownscaledPhoto {
  dataUri: string;
  bytes: number;
  /** True when the returned image is a re-encoded smaller copy. */
  resized: boolean;
}

export interface PhotoDownscaler {
  downscale(buffer: Buffer, contentType: string): Promise<DownscaledPhoto>;
  close(): Promise<void>;
}

function original(buffer: Buffer, contentType: string): DownscaledPhoto {
  return { dataUri: `data:${contentType};base64,${buffer.toString("base64")}`, bytes: buffer.length, resized: false };
}

/**
 * One downscaler per report render; open lazily (no page is created until a photo actually needs
 * resizing) and close it in a finally block. Safe to call concurrently.
 */
export function createPhotoDownscaler(maxEdge: number = REPORT_PHOTO_MAX_EDGE): PhotoDownscaler {
  let pagePromise: Promise<Page> | null = null;
  let disabled = false;

  async function getPage(): Promise<Page> {
    if (!pagePromise) {
      pagePromise = (async () => {
        const browser = await getSharedBrowser();
        return browser.newPage();
      })();
      pagePromise.catch(() => {
        pagePromise = null;
      });
    }
    return pagePromise;
  }

  return {
    async downscale(buffer, contentType) {
      const type = (contentType || "image/jpeg").toLowerCase();
      if (disabled || !isResizableImageType(type) || buffer.length < REPORT_PHOTO_SKIP_BELOW_BYTES) {
        return original(buffer, type);
      }
      try {
        const page = await getPage();
        const sourceUri = `data:${type};base64,${buffer.toString("base64")}`;
        const out = await page.evaluate(
          async (src: string, edge: number, quality: number) => {
            const blob = await (await fetch(src)).blob();
            const bitmap = await createImageBitmap(blob);
            const longest = Math.max(bitmap.width, bitmap.height);
            const scale = longest > edge ? edge / longest : 1;
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            // JPEG has no alpha: paint white first so transparent PNG areas do not turn black.
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(bitmap, 0, 0, w, h);
            bitmap.close();
            return canvas.toDataURL("image/jpeg", quality);
          },
          sourceUri,
          maxEdge,
          REPORT_PHOTO_JPEG_QUALITY
        );
        if (!out || !out.startsWith("data:image/jpeg;base64,")) return original(buffer, type);
        const bytes = Math.floor(((out.length - "data:image/jpeg;base64,".length) * 3) / 4);
        if (!shouldUseDownscaled(buffer.length, bytes)) return original(buffer, type);
        return { dataUri: out, bytes, resized: true };
      } catch (err) {
        // A browser problem must never lose the photo: stop trying for this report and embed originals.
        console.warn("[worker] Photo downscale failed, embedding the original:", err instanceof Error ? err.message : err);
        disabled = true;
        return original(buffer, type);
      }
    },
    async close() {
      const current = pagePromise;
      pagePromise = null;
      if (!current) return;
      try {
        const page = await current;
        await page.close();
      } catch {
        // Best-effort.
      }
    },
  };
}
