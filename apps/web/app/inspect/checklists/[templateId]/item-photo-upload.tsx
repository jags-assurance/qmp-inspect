"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { uploadOrQueuePhoto, PhotoRejectedError } from "@/lib/checklists/photo-upload-helpers";
import { cn } from "@/lib/cn";

interface Photo {
  id: string;
  storage_path: string;
  caption: string | null;
  url: string | null;
}

/**
 * Compact per-item photo affordance for ResponseRow (round-table field-ops finding: evidence
 * photos could previously only attach to "the whole inspection," never to a specific checklist
 * item/finding — nearly worthless in a dispute or ISO audit without that link). Deliberately tiny
 * in the common case (no photo attached yet): a single icon-button, no thumbnails grid, so it never
 * makes the row visually heavier. Once a photo is linked, a small thumbnail strip appears alongside
 * it. Shares the same compress/upload-or-queue flow as the generic PhotoUpload section via
 * uploadOrQueuePhoto — this just tags the row with checklistItemId.
 */
export function ItemPhotoUpload({
  projectId,
  inspectionRecordId,
  checklistItemId,
  photos,
  readOnly = false,
}: {
  projectId: string;
  inspectionRecordId: string;
  checklistItemId: string;
  photos: Photo[];
  readOnly?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queuedPreviews, setQueuedPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      queuedPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPhotos = photos.length > 0 || queuedPreviews.length > 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    if (uploading) return;
    // Type / size limits (before compression): images only, 25 MB each, 10 per batch.
    const files = picked.filter((f) => f.type.startsWith("image/") && f.size <= 25 * 1024 * 1024).slice(0, 10);
    const rejected = picked.length - files.length;
    setUploading(true);
    setError(rejected > 0 ? `${rejected} file${rejected === 1 ? "" : "s"} skipped (images only, max 25 MB each, 10 at a time).` : null);

    let failedCount = 0;
    let rejectedMsg: string | null = null;
    let done = 0;
    for (const file of files) {
      setProgress(`${++done} of ${files.length}`);
      try {
        const { queuedPreviewUrl } = await uploadOrQueuePhoto({ projectId, inspectionRecordId, checklistItemId, file });
        if (queuedPreviewUrl) setQueuedPreviews((prev) => [...prev, queuedPreviewUrl]);
      } catch (err) {
        failedCount += 1;
        if (err instanceof PhotoRejectedError) rejectedMsg = err.message;
      }
    }

    if (rejectedMsg) {
      setError(rejectedMsg);
    } else if (failedCount > 0) {
      setError(`Could not upload ${failedCount} of ${files.length} photo${files.length === 1 ? "" : "s"}. Check your connection and try again.`);
    }

    router.refresh();
    setUploading(false);
    setProgress("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasPhotos && (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((photo) => (
            <div key={photo.id} className="h-11 w-11 overflow-hidden rounded">
              <PhotoThumbnail url={photo.url} caption={photo.caption} photoId={photo.id} editable={!readOnly} />
            </div>
          ))}
          {queuedPreviews.map((url, i) => (
            <div key={url} className="relative h-10 w-10 overflow-hidden rounded">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Queued photo ${i + 1}`} className="h-full w-full object-cover opacity-70" />
              <span className="absolute inset-x-0 bottom-0 bg-warning/90 text-center text-[8px] font-medium leading-tight text-white">
                Queued
              </span>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
            id={`item-photo-input-${checklistItemId}`}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            title={hasPhotos ? "Add another photo to this item" : "Attach a photo to this item"}
            aria-label={hasPhotos ? "Add another photo to this item" : "Attach a photo to this item"}
            className={cn(
              "inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm font-medium text-muted transition-colors hover:bg-off-white disabled:opacity-60",
              hasPhotos && "border-dashed"
            )}
          >
            <span aria-hidden="true">📷</span>
            {uploading ? `Uploading ${progress}…` : hasPhotos ? "+ Add" : "+ Photo"}
          </button>
        </>
      )}
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}
