"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { addPhotoAction } from "@/lib/standalone/actions";
import { compressImageFile } from "@/lib/media/compress-image";
import { enqueueOutboxItem } from "@/lib/offline/db";
import { notifyOutboxChanged } from "@/lib/offline/sync-client";

/**
 * The file itself goes straight from the browser to the "inspection-evidence" Storage bucket;
 * once that succeeds, addPhotoAction is called directly (Server Actions can be invoked like any
 * async function from a Client Component, not only via a <form>) to record where it landed.
 */
export function PhotoUpload({ assignmentId }: { assignmentId: string }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadOne(rawFile: File): Promise<string | null> {
    const file = await compressImageFile(rawFile);

    if (!file.type.startsWith("image/")) return `${file.name} is not an image.`;
    if (file.size > 15 * 1024 * 1024) return `${file.name} is larger than 15 MB. Use a smaller photo.`;
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `standalone/${assignmentId}/${Date.now()}-${safeName}`;

    // Keep the photo on this device and send it when the connection returns.
    async function queueForLater(): Promise<string | null> {
      await enqueueOutboxItem({
        kind: "standalone_photo",
        fields: { kind: "standalone_photo", assignment_id: assignmentId, file_name: file.name, ...(caption.trim() ? { caption: caption.trim() } : {}) },
        file,
        fileName: file.name,
      });
      notifyOutboxChanged();
      setNotice("Saved on this device — it will be sent when you're back online.");
      return null;
    }
    if (!navigator.onLine) return queueForLater();

    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);
    if (uploadError) return navigator.onLine ? "Upload failed. Check your connection and try again." : queueForLater();

    const formData = new FormData();
    formData.set("assignment_id", assignmentId);
    formData.set("storage_path", path);
    if (caption.trim()) formData.set("caption", caption.trim());
    let result: { error: string | null };
    try {
      result = await addPhotoAction({ error: null }, formData);
    } catch {
      result = { error: "Could not save the photo record. Try again." };
    }
    if (result.error) {
      // Do not leave an orphan object in Storage when the record could not be saved.
      await supabase.storage.from("inspection-evidence").remove([path]).catch(() => undefined);
    }
    return result.error;
  }

  // Round-table field-usability finding: batch-select several photos at once instead of one tap
  // per photo, uploaded sequentially here so each still gets its own compress/upload handling.
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploading(true);
    setError(null);
    setNotice(null);

    let lastError: string | null = null;
    for (const file of files) {
      const err = await uploadOne(file);
      if (err) lastError = err;
    }
    if (lastError) setError(lastError);

    setUploading(false);
    if (!lastError) setCaption("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <label className="block text-xs text-muted">Caption (optional)</label>
      <input
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={200}
        placeholder="What does this photo show?"
        className="mt-1 mb-3 w-full rounded-md border border-border bg-off-white px-2 py-1.5 text-sm outline-none focus:border-burgundy"
      />
      <label className="block text-xs text-muted">Upload photo</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        disabled={uploading}
        onChange={handleFileChange}
        className="mt-1 block text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
      />
      {uploading && <p className="mt-1 text-xs text-muted">Uploading…</p>}
      {notice && <p className="mt-1 text-sm text-muted">{notice}</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
