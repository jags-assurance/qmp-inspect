"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { INSPECTION_PHOTOS_TABLE } from "@/lib/checklists/db-types";
import { Button } from "@/components/ui/button";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";
import { compressImageFile } from "@/lib/media/compress-image";

interface Photo {
  id: string;
  storage_path: string;
  caption: string | null;
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

  useEffect(() => {
    return () => {
      queuedPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function queueForOffline(file: File) {
    await enqueueOutboxItem({
      kind: "photo",
      fields: { project_id: projectId, inspection_record_id: inspectionRecordId, file_name: file.name },
      file,
      fileName: file.name,
    });
    notifyOutboxChanged();
    setQueuedPreviews((prev) => [...prev, URL.createObjectURL(file)]);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    setUploading(true);
    setError(null);
    const file = await compressImageFile(rawFile);

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await queueForOffline(file);
      } catch {
        setError("Could not queue the photo for later sync.");
      }
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    try {
      const supabase = createSupabaseBrowserClient();
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${projectId}/${inspectionRecordId}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);
      if (uploadError) throw uploadError;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error: insertError } = await supabase.from(INSPECTION_PHOTOS_TABLE).insert({
        inspection_record_id: inspectionRecordId,
        storage_path: path,
        uploaded_by: user?.id ?? null,
      });
      if (insertError) throw insertError;

      router.refresh();
    } catch {
      // Could be a genuine failure or a connection that dropped mid-upload — either way, don't
      // lose the photo: queue it the same as the offline path instead of just showing an error.
      try {
        await queueForOffline(file);
      } catch {
        setError("Could not upload the photo. Check your connection and try again.");
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => (
          <PhotoThumbnail key={photo.id} storagePath={photo.storage_path} />
        ))}
        {queuedPreviews.map((url, i) => (
          <div key={url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Queued photo ${i + 1}`} className="aspect-square w-full rounded-md object-cover opacity-70" />
            <span className="absolute bottom-1 left-1 rounded bg-warning/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
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
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
            id="photo-input"
          />
          <Button type="button" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? "Uploading…" : "+ Add photo"}
          </Button>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
