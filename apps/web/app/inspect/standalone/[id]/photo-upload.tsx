"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { addPhotoAction } from "@/lib/standalone/actions";

/**
 * The file itself goes straight from the browser to the "inspection-evidence" Storage bucket;
 * once that succeeds, addPhotoAction is called directly (Server Actions can be invoked like any
 * async function from a Client Component, not only via a <form>) to record where it landed.
 */
export function PhotoUpload({ assignmentId }: { assignmentId: string }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `standalone/${assignmentId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);

    if (uploadError) {
      setError("Upload failed. Check your connection and try again.");
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    const formData = new FormData();
    formData.set("assignment_id", assignmentId);
    formData.set("storage_path", path);
    const result = await addPhotoAction({ error: null }, formData);
    if (result.error) setError(result.error);

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
        disabled={uploading}
        onChange={handleFileChange}
        className="mt-1 block text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
      />
      {uploading && <p className="mt-1 text-xs text-muted">Uploading…</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
