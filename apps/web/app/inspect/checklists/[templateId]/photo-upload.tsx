"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { uploadOrQueuePhoto, PhotoRejectedError } from "@/lib/checklists/photo-upload-helpers";
import { usePhotoMarkup, MARKUP_PREF_KEY } from "@/components/domain/photo-markup";


interface Photo {
  id: string;
  storage_path: string;
  caption: string | null;
  url: string | null;
}

/**
 * Simple photo-evidence capture: upload straight to Supabase Storage from the browser (subject to
 * the same RLS as everything else — no server round-trip for the file bytes), then record the
 * resulting path as an inspection_photos row. Objects live at
 * {project_id}/{inspection_record_id}/{filename} in the `inspection-evidence` bucket.
 */
export function PhotoUpload({
  projectId,
  inspectionRecordId,
  photos,
  readOnly = false,
}: {
  projectId: string;
  inspectionRecordId: string;
  photos: Photo[];
  readOnly?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Offline (R60): a photo queued for later sync has no storage_path yet, so it's shown from its
  // own local object URL rather than via PhotoThumbnail (which fetches from Storage by path).
  const [queuedPreviews, setQueuedPreviews] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // Optional markup (annotate) step before upload. The preference is a per-device convenience only.
  const { markup, dialog: markupDialog } = usePhotoMarkup();
  const [markupFirst, setMarkupFirst] = useState(false);
  useEffect(() => {
    try {
      // Hydration-safe: localStorage is only readable after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMarkupFirst(window.localStorage.getItem(MARKUP_PREF_KEY) === "1");
    } catch {
      // storage unavailable: leave it off
    }
  }, []);
  function toggleMarkup(on: boolean) {
    setMarkupFirst(on);
    try {
      window.localStorage.setItem(MARKUP_PREF_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    return () => {
      queuedPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadOne(rawFile: File) {
    const { queuedPreviewUrl } = await uploadOrQueuePhoto({ projectId, inspectionRecordId, file: rawFile });
    if (queuedPreviewUrl) setQueuedPreviews((prev) => [...prev, queuedPreviewUrl]);
  }

  // Round-table field-usability finding: an inspector previously had to tap "Add photo" once per
  // photo, a real per-tap friction point when documenting several findings in one visit — `multiple`
  // lets them select a batch at once (e.g. from their camera roll after shooting several), uploaded
  // sequentially here so each one still gets its own compress/upload-or-queue handling.
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0 || uploading) return;
    const files = picked.filter((f) => f.type.startsWith("image/") && f.size <= 25 * 1024 * 1024).slice(0, 20);
    const rejected = picked.length - files.length;
    setUploading(true);
    setError(rejected > 0 ? `${rejected} file${rejected === 1 ? "" : "s"} skipped (images only, max 25 MB each).` : null);

    let failedCount = 0;
    let rejectedMsg: string | null = null;
    for (const original of files) {
      try {
        let file: File = original;
        if (markupFirst) {
          const marked = await markup(original);
          if (!marked) continue; // discarded in the editor
          file = marked;
        }
        await uploadOne(file);
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
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => (
          <PhotoThumbnail key={photo.id} url={photo.url} caption={photo.caption} photoId={photo.id} editable={!readOnly} />
        ))}
        {queuedPreviews.map((url, i) => (
          <div key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Queued photo ${i + 1}`} className="aspect-square w-full rounded-md object-cover opacity-70" />
            <span className="absolute bottom-1 start-1 rounded bg-warning/90 px-1.5 py-0.5 text-xs font-medium text-white">
              Queued
            </span>
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="mt-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
            id="photo-input"
          />
          <Button type="button" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? "Uploading…" : "+ Add photo"}
          </Button>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={markupFirst} onChange={(e) => toggleMarkup(e.target.checked)} />
            Mark up each photo (draw, arrow, circle) before it is uploaded
          </label>
          {markupDialog}
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
