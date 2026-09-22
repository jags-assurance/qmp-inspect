"use client";

import { useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { updateOrgLogoAction } from "@/lib/branding/actions";
import { Button } from "@/components/ui/button";

const ORG_BRANDING_BUCKET = "org-branding";
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — a logo has no business being larger than this.
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

/**
 * Same split as apps/web/app/inspect/vault/[projectId]/[folderId]/upload-form.tsx: the file itself
 * goes straight from the browser to the (private) "org-branding" Storage bucket, then the server
 * action is called directly (not via a <form action>, since the storage_path is only known after the
 * upload completes) to record organizations.branding_logo_path.
 */
export function LogoUploadForm({
  organizationId,
  currentLogoUrl,
}: {
  organizationId: string;
  currentLogoUrl: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic local preview of the just-picked file, shown immediately while the upload runs —
  // falls back to currentLogoUrl (the last saved logo) once cleared/on first render.
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("logo_file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("Choose an image file to upload.");
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Logo must be a PNG, JPEG, SVG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("Logo must be 2MB or smaller.");
      return;
    }

    setUploading(true);
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setLocalPreview(objectUrl);

    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${organizationId}/logo-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(ORG_BRANDING_BUCKET)
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setError("Upload failed — check your connection and try again.");
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
      setLocalPreview(null);
      return;
    }

    const formData = new FormData();
    formData.set("organization_id", organizationId);
    formData.set("storage_path", path);
    const result = await updateOrgLogoAction({ error: null }, formData);

    if (result.error) {
      setError(result.error);
      URL.revokeObjectURL(objectUrl);
      setLocalPreview(null);
    } else {
      formRef.current?.reset();
    }
    setUploading(false);
  }

  const previewSrc = localPreview ?? currentLogoUrl;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <span className="block text-xs text-muted">Live preview</span>
          <div className="mt-1 flex h-16 w-40 items-center justify-center rounded-md border border-border bg-off-white p-2">
            {previewSrc ? (
              // Signed/blob URLs — an <img> avoids next/image's remote-pattern allowlist entirely.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewSrc} alt="Organisation logo preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted">No logo uploaded</span>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="logo_file" className="block text-xs text-muted">
            Upload a new logo (PNG, JPEG, SVG, or WebP — max 2MB)
          </label>
          <input
            id="logo_file"
            name="logo_file"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="mt-1 block w-full max-w-xs text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-burgundy file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-burgundy/90"
          />
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" disabled={uploading}>
        {uploading ? "Uploading…" : "Upload logo"}
      </Button>
    </form>
  );
}
