"use client";

import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadWithResume } from "@/lib/storage/upload-client";
import { uploadVaultDocumentAction } from "@/lib/vault/actions";
import { checkVaultDuplicatesAction, type VaultDuplicateMatch } from "@/lib/vault/document-control-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

/**
 * The file itself goes straight from the browser to the "inspection-evidence" Storage bucket, then
 * the server action records the row and runs revision supersession. Multi-file drag and drop,
 * per-file status, duplicate detection (reference + revision) with an explicit "new revision of X?"
 * confirmation, and a "revise this document" mode (prefill) used by the document detail page.
 */
function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "");
  return withoutExt.replace(/[_-]+/g, " ").trim() || filename;
}

const MAX_UPLOAD_MB = 100;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|vbs|jar|dll)$/i;

type FileState = "queued" | "uploading" | "done" | "error";
interface FileRow {
  file: File;
  state: FileState;
  message?: string;
  /** 0..1 while a large file is going up in resumable chunks. */
  progress?: number;
}

export interface VaultUploadPrefill {
  revisesDocumentId: string;
  title: string;
  reference: string;
  nextRevision: string;
  currentRevision: string;
  currentStatus: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VaultUploadForm({
  projectId,
  folderId,
  folderKey,
  prefill,
}: {
  projectId: string;
  folderId: string;
  folderKey: string;
  prefill?: VaultUploadPrefill | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ documentNumber: string; internalReference: string | null } | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [duplicates, setDuplicates] = useState<VaultDuplicateMatch[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isBatch = rows.length > 1;

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    setDuplicates(null);
    setError(null);
    setRows((prev) => {
      const next = prefill ? [] : [...prev];
      for (const f of incoming) {
        if (!next.some((r) => r.file.name === f.name && r.file.size === f.size)) next.push({ file: f, state: "queued" });
      }
      return prefill ? next.slice(0, 1) : next;
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }

  function patchRow(index: number, patch: Partial<FileRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function uploadOne(
    file: File,
    title: string,
    fields: { document_reference: string; revision: string; document_date: string; notes: string; revises: string },
    onProgress?: (fraction: number) => void
  ): Promise<{ ok: boolean; error?: string; documentNumber?: string; internalReference?: string | null }> {
    const supabase = createSupabaseBrowserClient();
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `Larger than ${MAX_UPLOAD_MB} MB.` };
    if (BLOCKED_EXTENSIONS.test(file.name)) return { ok: false, error: "Executable/script files can't be stored in the vault." };
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `vault/${projectId}/${folderKey}/${Date.now()}-${safeName}`;

    // Large files go up in resumable chunks (S7-21) and survive a dropped connection; anything the
    // resumable path cannot do falls back to the ordinary single-request upload.
    const { error: uploadError } = await uploadWithResume(supabase, { bucket: "inspection-evidence", path, file, onProgress });
    if (uploadError) return { ok: false, error: "Upload failed. Check your connection and try again." };

    const formData = new FormData();
    formData.set("folder_id", folderId);
    formData.set("project_id", projectId);
    formData.set("storage_path", path);
    formData.set("file_size", String(file.size));
    formData.set("title", title);
    // In a batch each file is matched by its title: re-uploading a same-named file in this folder
    // becomes the next revision (the server numbers it) instead of a duplicate.
    formData.set("document_reference", fields.document_reference || title);
    formData.set("revision", fields.revision);
    formData.set("document_date", fields.document_date);
    formData.set("notes", fields.notes);
    if (fields.revises) formData.set("revises_document_id", fields.revises);

    const result = await uploadVaultDocumentAction({ error: null }, formData);
    if (result.error) {
      await supabase.storage.from("inspection-evidence").remove([path]);
      return { ok: false, error: result.error };
    }
    return { ok: true, documentNumber: result.documentNumber, internalReference: result.internalReference ?? null };
  }

  function readFields(form: HTMLFormElement) {
    const fd = new FormData(form);
    return {
      title: String(fd.get("title") ?? "").trim(),
      reference: String(fd.get("document_reference") ?? "").trim(),
      revision: String(fd.get("revision") ?? "").trim(),
      document_date: String(fd.get("document_date") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };
  }

  /** Step 1: validate, then ask the server about existing documents with the same reference. */
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (uploading) return;
    if (rows.length === 0) {
      setError("Choose or drop one or more files first.");
      return;
    }
    const f = readFields(e.currentTarget);
    if (!isBatch && !f.title) {
      setError("Enter a title for the document.");
      return;
    }
    setError(null);

    if (prefill) {
      await runUpload(true);
      return;
    }
    const items = rows.map((r, i) => ({
      key: String(i),
      reference: isBatch ? titleFromFilename(r.file.name) : f.reference,
      revision: isBatch ? "" : f.revision,
    }));
    try {
      const matches = await checkVaultDuplicatesAction(folderId, items);
      if (matches.length > 0) {
        setDuplicates(matches);
        return;
      }
    } catch {
      // Detection is a convenience: if it fails, the server-side supersede logic still applies.
    }
    await runUpload(true);
  }

  /** Step 2: do the uploads, sequentially, with per-file status. */
  async function runUpload(confirmed: boolean) {
    if (!confirmed || !formRef.current) return;
    const f = readFields(formRef.current);
    setDuplicates(null);
    setUploading(true);
    setError(null);
    setLastResult(null);

    let lastOk: { documentNumber: string; internalReference: string | null } | null = null;
    let failures = 0;
    for (let i = 0; i < rows.length; i++) {
      const file = rows[i].file;
      patchRow(i, { state: "uploading", message: undefined });
      const title = isBatch ? titleFromFilename(file.name) : f.title;
      const result = await uploadOne(file, title, {
        document_reference: isBatch ? "" : f.reference,
        revision: isBatch ? "" : f.revision,
        document_date: f.document_date,
        notes: f.notes,
        revises: prefill && !isBatch ? prefill.revisesDocumentId : "",
      }, (fraction) => patchRow(i, { progress: fraction }));
      if (result.ok) {
        patchRow(i, { state: "done" });
        if (result.documentNumber) lastOk = { documentNumber: result.documentNumber, internalReference: result.internalReference ?? null };
      } else {
        failures += 1;
        patchRow(i, { state: "error", message: result.error });
      }
    }

    if (failures === 0) {
      formRef.current?.reset();
      setRows([]);
      if (lastOk) setLastResult(lastOk);
    } else {
      setError(`${failures} of ${rows.length} file${rows.length === 1 ? "" : "s"} failed. Fix the problem and press Upload again; files that succeeded are marked done and will be skipped.`);
      // Drop the finished ones so a retry only resends the failures.
      setRows((prev) => prev.filter((r) => r.state !== "done"));
    }
    setUploading(false);
  }

  const doneCount = rows.filter((r) => r.state === "done").length;
  const fieldCls = "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      id="vault-upload"
      className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink">
        {prefill ? `New revision of "${prefill.title}"` : `Upload document${rows.length > 1 ? "s" : ""}`}
      </h2>
      {prefill && (
        <p className="rounded-md bg-off-white px-3 py-2 text-xs text-muted">
          Current revision is {prefill.currentRevision} ({prefill.currentStatus.replace("_", " ")}).{" "}
          {prefill.currentStatus === "approved"
            ? "It stays the controlled copy until this new revision is approved."
            : "This upload will replace it (it is not approved yet)."}
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed p-4 text-center ${dragOver ? "border-burgundy bg-off-white" : "border-border"}`}
      >
        <p className="text-sm text-ink">{prefill ? "Drop the new file here" : "Drag and drop files here"}</p>
        <p className="mt-0.5 text-xs text-muted">or</p>
        <label htmlFor="file" className="mt-1 inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-ink hover:bg-off-white">
          Choose file{prefill ? "" : "s"}
        </label>
        <input
          ref={inputRef}
          id="file"
          name="file"
          type="file"
          multiple={!prefill}
          disabled={uploading}
          onChange={(e) => {
            if (e.currentTarget.files) addFiles(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
          className="sr-only"
        />
        <p className="mt-2 text-xs text-muted">
          Up to {MAX_UPLOAD_MB} MB each. PDF, Word, Excel, images and plain text are all accepted; PDF, Word (.docx) and text also support AI drafting later.
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label="Files to upload">
          {rows.map((r, i) => (
            <li key={`${r.file.name}-${r.file.size}`} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-ink" title={r.file.name}>
                {r.file.name}
              </span>
              <span className="text-xs text-muted">{formatSize(r.file.size)}</span>
              <span
                className={`text-xs ${r.state === "error" ? "text-danger" : r.state === "done" ? "text-success" : "text-muted"}`}
                role="status"
              >
                {r.state === "queued" ? "Ready" : r.state === "uploading" ? (r.progress !== undefined ? `Uploading ${Math.round(r.progress * 100)}%` : "Uploading…") : r.state === "done" ? "Done" : r.message}
              </span>
              {!uploading && r.state !== "done" && (
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  className="min-h-11 px-2 text-xs text-muted hover:text-ink sm:min-h-0"
                  aria-label={`Remove ${r.file.name}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {uploading && (
        <div className="h-1.5 overflow-hidden rounded bg-off-white" aria-hidden="true">
          <div className="h-full bg-burgundy transition-all" style={{ width: `${(doneCount / Math.max(rows.length, 1)) * 100}%` }} />
        </div>
      )}

      {isBatch && (
        <p className="text-xs text-muted">
          {rows.length} files: each becomes its own document, titled from its filename (renameable afterwards). A file whose
          name matches an existing document here is filed as that document&apos;s next revision. Date and notes apply to all.
        </p>
      )}

      {!isBatch && (
        <>
          <div>
            <FormField label="Title">
              <input
              name="title"
              required
              maxLength={200}
              defaultValue={prefill?.title ?? ""}
              key={prefill?.revisesDocumentId ?? "new"}
              className={fieldCls}
            />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FormField label="Document reference (optional; the same reference files a new revision of that document)">
                <input
                name="document_reference"
                defaultValue={prefill?.reference ?? ""}
                readOnly={!!prefill}
                placeholder="e.g. the drawing number"
                className={fieldCls}
              />
              </FormField>
            </div>
            <div>
              <FormField label="Revision">
                <input name="revision" defaultValue={prefill?.nextRevision ?? "0"} key={`rev-${prefill?.revisesDocumentId ?? "new"}`} className={fieldCls} />
              </FormField>
            </div>
          </div>
        </>
      )}

      <div>
        <FormField label="Document date">
          <input name="document_date" type="date" className={`${fieldCls} max-w-xs`} />
        </FormField>
      </div>

      <div>
        <FormField label={<>{prefill ? "Change note (what changed in this revision)" : "Notes"}</>}>
          <textarea name="notes" rows={2} required={!!prefill} className={fieldCls} />
        </FormField>
      </div>

      {duplicates && duplicates.length > 0 && (
        <div role="alertdialog" aria-label="Possible duplicate or new revision" className="space-y-2 rounded-md border border-border bg-off-white p-3 text-sm">
          {duplicates.map((d) => {
            const row = rows[Number(d.key)];
            return (
              <p key={d.key} className="text-ink">
                {d.sameRevision ? (
                  <>
                    <strong>{row?.file.name}</strong>: revision {d.revision} of &quot;{d.title}&quot; already exists. Uploading again
                    will replace it{d.status === "approved" ? " only after approval (the approved copy stays current)" : ""}.
                  </>
                ) : (
                  <>
                    <strong>{row?.file.name}</strong>: this looks like a new revision of &quot;{d.title}&quot; (current Rev {d.revision},{" "}
                    {d.status.replace("_", " ")}).
                    {d.status === "approved" ? " The approved copy stays current until the new one is approved." : " It will supersede the unapproved one."}
                  </>
                )}
              </p>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => runUpload(true)} disabled={uploading}>
              Yes, upload as new revision
            </Button>
            <button type="button" onClick={() => setDuplicates(null)} className="min-h-11 px-3 text-sm text-muted hover:underline sm:min-h-0">
              Cancel, let me change the reference
            </button>
          </div>
        </div>
      )}

      {lastResult && (
        <p className="text-xs text-muted" role="status">
          Uploaded. Assigned document number: <span className="doc-id">{lastResult.documentNumber}</span>
          {lastResult.internalReference && <> (internal JAGS reference: {lastResult.internalReference})</>}
          . It now awaits approval.
        </p>
      )}

      {error && (
        <p className="whitespace-pre-line text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {!duplicates && (
        <Button type="submit" disabled={uploading || rows.length === 0}>
          {uploading
            ? `Uploading ${doneCount}/${rows.length}…`
            : prefill
              ? "Upload new revision"
              : rows.length > 1
                ? `Upload ${rows.length} files`
                : "Upload"}
        </Button>
      )}
    </form>
  );
}
