// S5-15: HEIC/HEIF photos. Chrome on Android (and most desktop Chrome/Firefox builds) cannot decode
// them, so they cannot be compressed in the browser and would be sent at full size. These helpers
// spot that case so the form can give a precise instruction instead of a generic "too big" error.

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
