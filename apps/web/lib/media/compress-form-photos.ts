"use client";

import { compressImageFile } from "./compress-image";
import { HEIC_TIP, isHeicLike, stillUndecodableHeic } from "./heic";

/** Server Actions are capped (next.config.ts serverActions.bodySizeLimit = 4 MB; hosts cap near 4.5 MB). */
export const FORM_PHOTO_BUDGET_BYTES = 3_800_000;

/**
 * Compresses every image in the named multipart fields of a FormData IN PLACE, before it is posted to
 * a Server Action, and checks the total fits the request budget. Returns an error message when the
 * photos still do not fit (the caller shows it and does not submit), otherwise null.
 */
export async function compressFormPhotos(formData: FormData, fieldNames: string[]): Promise<string | null> {
  let total = 0;
  let undecodableHeic = false;
  for (const name of fieldNames) {
    const entries = formData.getAll(name);
    if (entries.length === 0) continue;
    formData.delete(name);
    for (const entry of entries) {
      if (typeof entry === "string") {
        formData.append(name, entry);
        continue;
      }
      if (!entry.size) continue; // an empty file input still posts a zero-byte file
      const file = entry.type.startsWith("image/") || isHeicLike(entry) ? await compressImageFile(entry) : entry;
      if (stillUndecodableHeic(entry, file)) undecodableHeic = true;
      total += file.size;
      formData.append(name, file);
    }
  }
  if (total > FORM_PHOTO_BUDGET_BYTES) {
    return `These photos are ${(total / 1_048_576).toFixed(1)} MB after compression, more than the ${(FORM_PHOTO_BUDGET_BYTES / 1_048_576).toFixed(1)} MB one submission can carry. Attach fewer photos now and add the rest afterwards.${undecodableHeic ? ` ${HEIC_TIP}` : ""}`;
  }
  return null;
}
