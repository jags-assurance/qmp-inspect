"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { addPhotoAction } from "@/lib/standalone/actions";
import { compressImageFile } from "@/lib/media/compress-image";

/**
 * The file itself goes straight from the browser to the "inspection-evidence" Storage bucket;
 * once that succeeds, addPhotoAction is called directly (Server Actions can be invoked like any
 * async function from a Client Component, not only via a <form>) to record where it landed.
 */
export function PhotoUpload({ assignmentId }: { assignmentId: string }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(rawFile: File): Promise<string | null> {
    const file = await compressImageFile(rawFile);

    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `standalone/${assignmentId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);
    if (uploadError) return "Upload failed. Check your connection and try again.";

    const formData = new FormData();
    formData.set("assignment_id", assignmentId);
    formData.set("storage_path", path);
    const result = await addPhotoAction({ error: null }, formData);
    return result.error;
  }

  // Round-table field-usability finding: batch-select several photos at once instead of one tap
  // per photo, uploaded sequentially here so each still gets its own compress/upload handling.
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    let lastError: string | null = null;
    for (const file of files) {
      const err = await uploadOne(file);
      if (err) lastError = err;
    }
    if (lastError) setError(lastError);

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label className="block text-xs text-muted">Upload photo</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        disabled={uploading}
        onChange={handleFileChange}
        className="mt-1 block text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
      />
      {uploading && <p className="mt-1 text-xs text-muted">Uploading…</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
