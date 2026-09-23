"use client";

/**
 * Renders one inspection-evidence photo as a thumbnail from an ALREADY-RESOLVED signed URL — the
 * caller (a Server Component page) batches every photo's signed URL in one call via
 * lib/storage/signed-urls.ts's getSignedPhotoUrls and passes each one down, rather than this
 * component fetching its own signed URL client-side. A `null` url (still resolving upstream, or the
 * photo failed to sign) simply renders an empty frame instead of a broken image.
 */
export function PhotoThumbnail({ url, caption }: { url: string | null; caption?: string | null }) {
  return (
    <div className="aspect-square overflow-hidden rounded-md border border-border bg-off-white">
      {url && <img src={url} alt={caption ?? "Inspection evidence"} className="h-full w-full object-cover" />}
    </div>
  );
}
