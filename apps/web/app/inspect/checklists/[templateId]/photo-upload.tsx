"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { INSPECTION_PHOTOS_TABLE } from "@/lib/checklists/db-types";
import { Button } from "@/components/ui/button";
import { PhotoThumbnail } from "@/components/domain/photo-thumbnail";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

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
      setError("Could not upload the photo. Check your connection and try again.");
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
