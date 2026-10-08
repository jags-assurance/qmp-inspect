// S5-15: HEIC/HEIF photos. Chrome and Firefox cannot decode them natively, so compress-image.ts converts
// them to JPEG in the browser (lazy-loaded heic-to, see convert-heic.ts). These helpers detect HEIC by
// MIME, extension or magic bytes and carry the user-facing failure message.

export function isHeicLike(file: { name: string; type: string }): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  return /\.(heic|heif)$/i.test(file.name || "");
}

/** A file that is still HEIC after the compression pass could not be decoded by this browser. */
export function stillUndecodableHeic(original: { name: string; type: string }, processed: { name: string; type: string }): boolean {
  return isHeicLike(original) && isHeicLike(processed);
}

export const HEIC_TIP =
  "Some photos are in HEIC format, which this browser cannot shrink. On an iPhone choose Settings > Camera > Formats > Most Compatible, or share the photo as JPEG, then add it again.";

// Brands (ISO-BMFF `ftyp` major or compatible brand) used by HEIC/HEIF images. "mif1"/"msf1" alone are
// deliberately not listed: AVIF uses them too, and only HEIC needs the conversion.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/**
 * Magic-byte check on the first bytes of a file: an ISO-BMFF `ftyp` box whose major or compatible
 * brands include a HEIC brand. Catches photos whose name/MIME was lost (iOS share sheets and some
 * Android pickers report "" or "image/jpeg" for a HEIC).
 */
export function hasHeicSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(4, 8) !== "ftyp") return false;
  const boxSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length);
  if (HEIC_BRANDS.has(ascii(8, 12))) return true;
  // Bytes 12-16 are the minor version; compatible brands follow in 4-byte steps.
  for (let i = 16; i + 4 <= end; i += 4) if (HEIC_BRANDS.has(ascii(i, i + 4))) return true;
  return false;
}

/** HEIC by MIME or extension, or - when those do not say - by reading the file's leading bytes. */
export async function isHeicFile(file: File): Promise<boolean> {
  if (isHeicLike(file)) return true;
  const type = (file.type || "").toLowerCase();
  // Skip the read for formats that are plainly something else.
  if (type && type !== "application/octet-stream" && !type.startsWith("image/")) return false;
  if (/^image\/(png|webp|gif|svg\+xml)$/.test(type)) return false;
  try {
    return hasHeicSignature(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  } catch {
    return false;
  }
}

export const HEIC_CONVERT_FAILED_MESSAGE =
  "This HEIC photo could not be converted to JPEG on this device. On an iPhone choose Settings > Camera > Formats > Most Compatible, or share the photo as JPEG, then add it again.";

/** Thrown when a HEIC photo cannot be decoded or converted; the message is safe to show to the user. */
export class HeicConversionError extends Error {
  constructor(message: string = HEIC_CONVERT_FAILED_MESSAGE) {
    super(message);
    this.name = "HeicConversionError";
  }
}
