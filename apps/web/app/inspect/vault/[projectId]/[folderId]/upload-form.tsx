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
/** Strips the extension and swaps underscores/dashes for spaces — a readable default title for a
 * batch upload, where there's no single Title field to fill in per file. Still just a starting
 * point: every row it creates can be retitled afterward like any other document. */
function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "");
  return withoutExt.replace(/[_-]+/g, " ").trim() || filename;
}

const MAX_UPLOAD_MB = 100;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|vbs|jar|dll)$/i;

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  async function uploadOne(
    file: File,
    title: string,
    sharedFields: { document_reference: string; revision: string; document_date: string; notes: string }
  ): Promise<{ ok: boolean; error?: string; documentNumber?: string; internalReference?: string | null }> {
    const supabase = createSupabaseBrowserClient();
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `${file.name}: file is larger than ${MAX_UPLOAD_MB} MB.` };
    }
    if (BLOCKED_EXTENSIONS.test(file.name)) {
      return { ok: false, error: `${file.name}: this file type (executable/script) can't be stored in the vault.` };
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `vault/${projectId}/${folderKey}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(path, file);
    if (uploadError) return { ok: false, error: `${file.name}: upload failed — check your connection and try again.` };

    const formData = new FormData();
    formData.set("folder_id", folderId);
    formData.set("project_id", projectId);
    formData.set("storage_path", path);
    formData.set("file_size", String(file.size));
    formData.set("title", title);
    formData.set("document_reference", sharedFields.document_reference);
    formData.set("revision", sharedFields.revision);
    formData.set("document_date", sharedFields.document_date);
    formData.set("notes", sharedFields.notes);

    const result = await uploadVaultDocumentAction({ error: null }, formData);
    if (result.error) {
      // The record wasn't saved, so don't leave the already-uploaded file orphaned in storage.
      await supabase.storage.from("inspection-evidence").remove([path]);
      return { ok: false, error: `${file.name}: ${result.error}` };
    }
    return { ok: true, documentNumber: result.documentNumber, internalReference: result.internalReference ?? null };
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const files = Array.from(fileInput.files ?? []);
    if (files.length === 0) {
      setError("Choose one or more files to upload.");
      return;
    }

    const titleInput = form.elements.namedItem("title") as HTMLInputElement;
    const isBatch = files.length > 1;
    const baseFormData = new FormData(form);
    const sharedFields = {
      document_reference: isBatch ? "" : String(baseFormData.get("document_reference") ?? ""),
      revision: String(baseFormData.get("revision") ?? "0"),
      document_date: String(baseFormData.get("document_date") ?? ""),
      notes: String(baseFormData.get("notes") ?? ""),
    };

    setUploading(true);
    setError(null);
    setLastResult(null);
    setProgress({ done: 0, total: files.length });

    const errors: string[] = [];
    let lastOk: { documentNumber: string; internalReference: string | null } | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const title = isBatch ? titleFromFilename(file.name) : titleInput.value;
      const result = await uploadOne(file, title, sharedFields);
      if (!result.ok) {
        errors.push(result.error ?? `${file.name}: unknown error`);
      } else if (result.documentNumber) {
        lastOk = { documentNumber: result.documentNumber, internalReference: result.internalReference ?? null };
      }
      setProgress({ done: i + 1, total: files.length });
    }

    if (errors.length > 0) {
      setError(
        files.length === 1
          ? errors[0]
          : `${errors.length} of ${files.length} failed:\n${errors.join("\n")}`
      );
    } else {
      formRef.current?.reset();
      setSelectedCount(0);
      if (lastOk) setLastResult(lastOk);
    }
    setUploading(false);
    setProgress(null);
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink">Upload document{selectedCount > 1 ? "s" : ""}</h2>

      <div>
        <label htmlFor="file" className="block text-xs text-muted">
          File{selectedCount > 1 ? "s" : ""}
        </label>
        <input
          id="file"
          name="file"
          type="file"
          multiple
          required
          disabled={uploading}
          onChange={(e) => setSelectedCount(e.currentTarget.files?.length ?? 0)}
          className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-muted">
          {selectedCount > 1
            ? `${selectedCount} files selected — each becomes its own document, titled from its filename (renameable after upload). Date and notes below apply to all of them.`
            : "Select multiple files at once to upload them all into this folder in one go. PDF, Word (.docx), or plain text/.md support AI-assisted generation later — other file types still upload and store fine, just without that."}
        </p>
      </div>

      {selectedCount <= 1 && (
        <>
          <div>
            <label htmlFor="title" className="block text-xs text-muted">
              Title
            </label>
            <input
              id="title"
              name="title"
              required={selectedCount <= 1}
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
        </>
      )}

      <div>
        <label htmlFor="document_date" className="block text-xs text-muted">
          Document date
        </label>
        <input
          id="document_date"
          name="document_date"
          type="date"
          className="mt-1 w-full max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
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

      {progress && (
        <p className="text-xs text-muted">
          Uploading {progress.done} of {progress.total}…
        </p>
      )}

      {error && <p className="whitespace-pre-line text-sm text-danger">{error}</p>}

      <Button type="submit" disabled={uploading}>
        {uploading
          ? progress
            ? `Uploading ${progress.done}/${progress.total}…`
            : "Uploading…"
          : selectedCount > 1
            ? `Upload ${selectedCount} files`
            : "Upload"}
      </Button>
    </form>
  );
}
