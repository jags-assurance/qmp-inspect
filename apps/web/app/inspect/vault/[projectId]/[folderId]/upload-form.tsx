"use client";

import { useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadVaultDocumentAction } from "@/lib/vault/actions";
import { Button } from "@/components/ui/button";

/**
 * Same split as apps/web/app/inspect/standalone/[id]/photo-upload.tsx: the file itself goes
 * straight from the browser to the "inspection-evidence" Storage bucket, then the server action is
 * called directly (not via a <form action>, since the storage_path is only known after the upload
 * completes) to record the row and run revision supersession.
 */
export function VaultUploadForm({
  projectId,
  folderId,
  folderKey,
}: {
  projectId: string;
  folderId: string;
  folderKey: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ documentNumber: string; internalReference: string | null } | null>(
    null
  );
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }

    setUploading(true);
    setError(null);
    setLastResult(null);

    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `vault/${projectId}/${folderKey}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);

    if (uploadError) {
      setError("Upload failed. Check your connection and try again.");
      setUploading(false);
      return;
    }

    const formData = new FormData(form);
    formData.set("folder_id", folderId);
    formData.set("project_id", projectId);
    formData.set("storage_path", path);
    formData.set("file_size", String(file.size));

    const result = await uploadVaultDocumentAction({ error: null }, formData);
    if (result.error) {
      setError(result.error);
    } else {
      formRef.current?.reset();
      if (result.documentNumber) {
        setLastResult({
          documentNumber: result.documentNumber,
          internalReference: result.internalReference ?? null,
        });
      }
    }
    setUploading(false);
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink">Upload document</h2>

      <div>
        <label htmlFor="title" className="block text-xs text-muted">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="document_reference" className="block text-xs text-muted">
            Revision key (optional — match an existing document to supersede it)
          </label>
          <input
            id="document_reference"
            name="document_reference"
            placeholder="e.g. an existing drawing number, to file this as its next revision"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="revision" className="block text-xs text-muted">
            Revision
          </label>
          <input
            id="revision"
            name="revision"
            defaultValue="0"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="document_date" className="block text-xs text-muted">
            Document date
          </label>
          <input
            id="document_date"
            name="document_date"
            type="date"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
          />
        </div>
        <div>
          <label htmlFor="file" className="block text-xs text-muted">
            File
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            disabled={uploading}
            className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="block text-xs text-muted">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
      </div>

      {lastResult && (
        <p className="text-xs text-muted">
          Assigned document number: <span className="doc-id">{lastResult.documentNumber}</span>
          {lastResult.internalReference && (
            <>
              {" "}— internal JAGS traceability reference (white-label, not shown to the client):{" "}
              {lastResult.internalReference}
            </>
          )}
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" disabled={uploading}>
        {uploading ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
