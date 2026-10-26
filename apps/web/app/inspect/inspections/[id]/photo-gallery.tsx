"use client";

import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { Tx } from "@/components/domain/tx";

interface GalleryPhoto {
  id: string;
  url: string | null;
  caption: string | null;
  /** The checklist item this photo is proof for; null when it was attached to the inspection as a whole. */
  itemId?: string | null;
  itemLabel?: string | null;
}

/**
 * Photos grouped by what they prove: one block per checklist item (labelled "Item 2 — …"), then the photos
 * attached to the inspection as a whole. `itemsWithoutEvidence` lists the answered items that have neither a
 * photo nor a linked document of their own, so a reader can see at a glance what a single general photo does
 * not cover.
 */
export function PhotoGallery({
  photos,
  itemsWithoutEvidence = [],
}: {
  photos: GalleryPhoto[];
  itemsWithoutEvidence?: string[];
}) {
  if (photos.length === 0 && itemsWithoutEvidence.length === 0) {
    return <p className="text-sm text-muted"><Tx>No photos were attached.</Tx></p>;
  }

  const byItem = new Map<string, { label: string; photos: GalleryPhoto[] }>();
  const general: GalleryPhoto[] = [];
  for (const p of photos) {
    if (p.itemId && p.itemLabel) {
      const g = byItem.get(p.itemId) ?? { label: p.itemLabel, photos: [] };
      g.photos.push(p);
      byItem.set(p.itemId, g);
    } else {
      general.push(p);
    }
  }
  const grid = "grid grid-cols-3 gap-2 sm:grid-cols-4";

  return (
    <div className="space-y-5">
      {[...byItem.entries()].map(([itemId, g]) => (
        <div key={itemId}>
          <h3 className="text-sm font-medium text-ink">{g.label}</h3>
          <div className={`mt-2 ${grid}`}>
            {g.photos.map((photo) => (
              <PhotoThumbnail key={photo.id} url={photo.url} caption={photo.caption} />
            ))}
          </div>
        </div>
      ))}
      {general.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-ink"><Tx>Whole inspection (not tied to one item)</Tx></h3>
          <div className={`mt-2 ${grid}`}>
            {general.map((photo) => (
              <PhotoThumbnail key={photo.id} url={photo.url} caption={photo.caption} />
            ))}
          </div>
        </div>
      )}
      {itemsWithoutEvidence.length > 0 && (
        <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-ink">
          <p className="font-medium"><Tx>No photo or document of its own for these items:</Tx></p>
          <ul className="mt-1 list-disc ps-5 text-xs text-muted">
            {itemsWithoutEvidence.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
