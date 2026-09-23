"use client";

import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";

export function PhotoGallery({ photos }: { photos: { id: string; url: string | null; caption: string | null }[] }) {
  if (photos.length === 0) return <p className="text-sm text-muted">No photos were attached.</p>;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo) => (
        <PhotoThumbnail key={photo.id} url={photo.url} caption={photo.caption} />
      ))}
    </div>
  );
}
