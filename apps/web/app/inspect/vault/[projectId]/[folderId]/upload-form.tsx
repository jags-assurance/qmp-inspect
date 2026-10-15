"use client";

import { nextRevision } from "@/lib/vault/revision";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadWithResume } from "@/lib/storage/upload-client";
import { VAULT_DEFAULT_UPLOAD_MB, vaultFileTooLargeMessage } from "@/lib/vault/limits";
import { uploadVaultDocumentAction } from "@/lib/vault/actions";
import { checkVaultDuplicatesAction, type VaultDuplicateMatch } from "@/lib/vault/document-control-actions";
import { buttonVariants, Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
  maxUploadMb = VAULT_DEFAULT_UPLOAD_MB,
}: {
  projectId: string;
  folderId: string;
  folderKey: string;
  prefill?: VaultUploadPrefill | null;
  /** This organisation's per-file limit (default 50 MB); the server enforces the same number. */
  maxUploadMb?: number;
}) {
  const MAX_UPLOAD_MB = maxUploadMb;
  const MAX_UPLOAD_BYTES = maxUploadMb * 1024 * 1024;
  const tl = useTranslate();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ documentNumber: string; internalReference: string | null; count: number; title: string } | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [duplicates, setDuplicates] = useState<VaultDuplicateMatch[] | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

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
    // One file and no title typed yet: use the filename, so the common upload is just "pick file, Upload".
    if (!prefill && incoming.length === 1 && titleRef.current && !titleRef.current.value.trim()) {
      titleRef.current.value = titleFromFilename(incoming[0].name);
    }
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
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: vaultFileTooLargeMessage(file.size, MAX_UPLOAD_MB) };
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
    let okCount = 0;
    let lastTitle = "";
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
        okCount += 1;
        lastTitle = title;
        if (result.documentNumber) lastOk = { documentNumber: result.documentNumber, internalReference: result.internalReference ?? null };
      } else {
        failures += 1;
        patchRow(i, { state: "error", message: result.error });
      }
    }

    if (failures === 0) {
      formRef.current?.reset();
      setRows([]);
      if (lastOk) setLastResult({ ...lastOk, count: okCount, title: lastTitle });
    } else {
      if (okCount > 0 && lastOk) setLastResult({ ...lastOk, count: okCount, title: lastTitle });
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
          <Tx>Current revision is</Tx> {prefill.currentRevision} ({prefill.currentStatus.replace("_", " ")}).{" "}
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
        className={`rounded-lg p-0 text-center md:border-2 md:border-dashed md:p-6 ${dragOver ? "md:border-burgundy md:bg-brand-soft" : "md:border-control-border"}`}
      >
        <p className="hidden text-sm text-ink md:block">{prefill ? "Drop the new file here" : "Drag and drop files here"}</p>
        <p className="mt-0.5 hidden text-xs text-muted md:block"><Tx>or</Tx></p>
        <label htmlFor="file" className={buttonVariants({ variant: "outline", size: "lg", className: "mt-1 w-full cursor-pointer md:w-auto focus-within:outline" })}>
          <Tx>Choose file</Tx>{prefill ? "" : "s"}
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
          <Tx>Up to</Tx> {MAX_UPLOAD_MB} <Tx>MB each.</Tx>
        </p>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label={tl("Files to upload")}>
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
                  <Tx>Remove</Tx>
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
          {rows.length} <Tx>files: each becomes its own document, titled from its filename.</Tx>
        </p>
      )}

      {!isBatch && (
        <div>
          <FormField label="Title">
            <input
              ref={titleRef}
              name="title"
              required
              maxLength={200}
              defaultValue={prefill?.title ?? ""}
              key={prefill?.revisesDocumentId ?? "new"}
              className={fieldCls}
            />
          </FormField>
        </div>
      )}

      {(() => {
        const referenceAndRevision = !isBatch && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <FormField label="Document reference (optional)">
                <input
                  name="document_reference"
                  defaultValue={prefill?.reference ?? ""}
                  readOnly={!!prefill}
                  placeholder={tl("e.g. the drawing number")}
                  className={fieldCls}
                />
              </FormField>
            </div>
            <div>
              <FormField label="Revision">
                <input name="revision" defaultValue={prefill?.nextRevision ?? "0"} key={`rev-${prefill?.revisesDocumentId ?? "new"}`} className={fieldCls} />
              </FormField>
              {!prefill && (
                <p className="mt-1 text-xs text-muted">
                  <Tx>Leave as 0 and the next revision number is assigned automatically when this reference already exists.</Tx>
                </p>
              )}
            </div>
          </div>
        );
        const dateField = (
          <div>
            <FormField label="Document date">
              <input name="document_date" type="date" className={`${fieldCls} max-w-xs`} />
            </FormField>
          </div>
        );
        const notesField = (
          <div>
            <FormField label={<>{prefill ? "Change note (what changed in this revision)" : "Notes"}</>}>
              <textarea name="notes" rows={2} required={!!prefill} className={fieldCls} />
            </FormField>
          </div>
        );
        // A new revision needs its change note, so everything stays visible there. A plain upload only
        // needs a file (the title comes from the filename): the rest is tucked into one optional block.
        return prefill ? (
          <>
            {referenceAndRevision}
            {dateField}
            {notesField}
          </>
        ) : (
          <details className="rounded-md border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-ink">
              <Tx>More details (optional): reference, revision, date, notes</Tx>
            </summary>
            <div className="mt-3 space-y-4">
              {referenceAndRevision}
              {dateField}
              {notesField}
            </div>
          </details>
        );
      })()}

      {duplicates && duplicates.length > 0 && (
        <div role="alertdialog" aria-label={tl("Possible duplicate or new revision")} className="space-y-2 rounded-md border border-border bg-off-white p-3 text-sm">
          {duplicates.map((d) => {
            const row = rows[Number(d.key)];
            return (
              <p key={d.key} className="text-ink">
                {d.sameRevision ? (
                  <>
                    <strong>{row?.file.name}</strong><Tx>: revision</Tx> {d.revision} <Tx>of &quot;</Tx>{d.title}<Tx>&quot; already exists. Uploading again will replace it</Tx>{d.status === "approved" ? " only after approval (the approved copy stays current)" : ""}.
                  </>
                ) : (
                  <>
                    <strong>{row?.file.name}</strong><Tx>: this looks like a new revision of &quot;</Tx>{d.title}<Tx>&quot; (current Rev</Tx> {d.revision},{" "}
                    {d.status.replace("_", " ")}).
                    {d.status === "approved" ? " The approved copy stays current until the new one is approved." : " It will supersede the unapproved one."}
                    {nextRevision(d.revision) ? ` It will be numbered Rev ${nextRevision(d.revision)} unless you typed a different revision.` : ""}
                  </>
                )}
              </p>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => runUpload(true)} disabled={uploading}>
              <Tx>Yes, upload as new revision</Tx>
            </Button>
            <Button type="button" onClick={() => setDuplicates(null)} variant="link-muted">
              <Tx>Cancel, let me change the reference</Tx>
            </Button>
          </div>
        </div>
      )}

      {lastResult && (
        <div className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success" role="status" aria-live="polite">
          <p className="font-medium">
            {lastResult.count > 1
              ? `${lastResult.count} documents uploaded.`
              : `"${lastResult.title}" uploaded.`}
          </p>
          <p className="mt-0.5 text-xs">
            <Tx>Assigned document number:</Tx> <span className="doc-id">{lastResult.documentNumber}</span>
            {lastResult.internalReference && <> <Tx>(internal JAGS reference:</Tx> {lastResult.internalReference})</>}
            {lastResult.count > 1 ? " (last of the batch)" : ""}
            <Tx>. It now awaits approval.</Tx>
          </p>
        </div>
      )}

      {error && (
        <p className="whitespace-pre-line text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {!duplicates && (
        <StickyActionBar inCard>
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={uploading || rows.length === 0}>
          {uploading
            ? `Uploading ${doneCount}/${rows.length}…`
            : prefill
              ? "Upload new revision"
              : rows.length > 1
                ? `Upload ${rows.length} files`
                : "Upload"}
        </Button>
        </StickyActionBar>
      )}
    </form>
  );
}
