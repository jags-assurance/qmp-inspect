"use client";

import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";

export function PhotoGallery({ photos }: { photos: { id: string; storage_path: string; caption: string | null }[] }) {
  if (photos.length === 0) return <p className="text-sm text-muted">No photos were attached.</p>;

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((photo) => (
        <PhotoThumbnail key={photo.id} storagePath={photo.storage_path} caption={photo.caption} />
      ))}
    </div>
  );
}
