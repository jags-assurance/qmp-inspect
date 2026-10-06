"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { linkInspectionEvidenceDocumentAction, type LinkInspectionEvidenceDocumentState } from "@/lib/checklists/actions";
import { uploadItemDocumentAction, unlinkItemDocumentAction } from "@/lib/checklists/item-document-actions";
import { VaultFilePicker, type VaultPickerDocument, type VaultPickerFolder } from "@/components/domain/vault-file-picker";

export interface ItemLinkedDocument {
  linkId: string;
  vaultDocumentId: string;
  title: string;
  documentReference: string | null;
  status: string;
}

const ITEM_DOC_MAX_BYTES = 25 * 1024 * 1024;
const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|ps1|sh|js|mjs|vbs|jar|dll|apk|app|bin|reg|lnk|html?|php|py)$/i;
const ALLOWED = /\.(pdf|docx?|xlsx?|csv|txt|png|jpe?g|gif|webp|heic|bmp|tiff?)$/i;
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*";
const initial: LinkInspectionEvidenceDocumentState = { error: null };

const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium";

export function ItemDocuments({
  projectId,
  inspectionRecordId,
  checklistItemId,
  itemNumber,
  documents,
  vaultOptions,
  vaultFolders = [],
  readOnly,
}: {
  projectId: string;
  inspectionRecordId: string;
  checklistItemId: string;
  itemNumber: string;
  documents: ItemLinkedDocument[];
  /** Approved vault files the executing party may pick from (already-linked ones are filtered out here). */
  vaultOptions: VaultPickerDocument[];
  vaultFolders?: VaultPickerFolder[];
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"vault" | "upload">("vault");
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const linked = new Set(documents.map((d) => d.vaultDocumentId));
  const available = vaultOptions.filter((d) => !linked.has(d.id));

  return (
    <div className="space-y-2">
      {documents.length > 0 && (
        <ul className="space-y-1.5" aria-label={`Documents linked to item ${itemNumber}`}>
          {documents.map((d) => (
            <li key={d.linkId} className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-1.5 text-sm">
              <a
                href={`/inspect/vault/${projectId}/document/${d.vaultDocumentId}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 text-burgundy hover:underline [overflow-wrap:anywhere]"
              >
                {d.title}
                {d.documentReference && <span className="text-muted"> ({d.documentReference})</span>}
              </a>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-xs font-medium " +
                  (d.status === "approved" ? "bg-success/10 text-success" : "bg-warning/15 text-warning")
                }
              >
                {d.status === "approved" ? "Approved" : "Pending vault approval"}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  disabled={removing}
                  aria-label={`Remove document ${d.title} from item ${itemNumber}`}
                  onClick={() =>
                    startRemove(async () => {
                      const r = await unlinkItemDocumentAction({ inspectionRecordId, linkId: d.linkId });
                      setRemoveError(r.error);
                    })
                  }
                  className="min-h-11 px-2 text-xs text-danger hover:underline disabled:opacity-60"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removeError && <p role="alert" className="text-xs text-danger">{removeError}</p>}

      {!readOnly && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Attach a document to item ${itemNumber}`}
          className={btn + " gap-1 text-muted hover:bg-off-white"}
        >
          <span aria-hidden="true">📎</span> + Document
        </button>
      )}

      {!readOnly && open && (
        <div className="space-y-3 rounded-md border border-border bg-off-white p-3">
          <div role="tablist" aria-label="Document source" className="flex gap-2">
            {(["vault", "upload"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={btn + " flex-1 " + (mode === m ? "border-burgundy bg-burgundy text-white" : "bg-surface text-ink")}
              >
                {m === "vault" ? "From Document Vault" : "Upload new"}
              </button>
            ))}
          </div>
          {mode === "vault" ? (
            <VaultLinkForm
              inspectionRecordId={inspectionRecordId}
              checklistItemId={checklistItemId}
              available={available}
              projectId={projectId}
              folders={vaultFolders}
              onDone={() => setOpen(false)}
            />
          ) : (
            <UploadForm
              projectId={projectId}
              inspectionRecordId={inspectionRecordId}
              checklistItemId={checklistItemId}
              itemNumber={itemNumber}
              onDone={() => setOpen(false)}
            />
          )}
          <button type="button" onClick={() => setOpen(false)} className="min-h-11 text-sm text-muted hover:underline">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function VaultLinkForm({
  inspectionRecordId,
  checklistItemId,
  available,
  projectId,
  folders,
  onDone,
}: {
  inspectionRecordId: string;
  checklistItemId: string;
  available: VaultPickerDocument[];
  projectId: string;
  folders: VaultPickerFolder[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(async (prev: LinkInspectionEvidenceDocumentState, fd: FormData) => {
    const r = await linkInspectionEvidenceDocumentAction(prev, fd);
    if (!r.error) onDone();
    return r;
  }, initial);
  if (available.length === 0 && folders.length === 0) {
    return <p className="text-sm text-muted">No approved files in the Document Vault are available to link. Use &ldquo;Upload new&rdquo; instead.</p>;
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <input type="hidden" name="checklist_item_id" value={checklistItemId} />
      <VaultFilePicker documents={available} projectId={projectId} folders={folders} allowUpload allowPendingUploads />
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      <button type="submit" disabled={pending} className={btn + " w-full bg-burgundy text-white disabled:opacity-60"}>
        {pending ? "Linking…" : "Link selected files"}
      </button>
    </form>
  );
}

function UploadForm({
  projectId,
  inspectionRecordId,
  checklistItemId,
  itemNumber,
  onDone,
}: {
  projectId: string;
  inspectionRecordId: string;
  checklistItemId: string;
  itemNumber: string;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file) return setError("Choose a file first.");
    if (BLOCKED.test(file.name) || !ALLOWED.test(file.name)) return setError("This file type isn't allowed. Use PDF, Word, Excel, CSV, TXT or an image.");
    if (file.size > ITEM_DOC_MAX_BYTES) return setError("File must be 25 MB or smaller.");
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `vault/${projectId}/checklists_forms/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("inspection-evidence").upload(path, file);
    if (upErr) {
      setBusy(false);
      return setError("Upload failed — check your connection and try again.");
    }
    const r = await uploadItemDocumentAction({ inspectionRecordId, checklistItemId, itemNumber, storagePath: path, fileName: file.name, fileSize: file.size });
    if (r.error) {
      await supabase.storage.from("inspection-evidence").remove([path]);
      setBusy(false);
      return setError(r.error);
    }
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`item-doc-file-${checklistItemId}`} className="block text-sm text-ink">
        Choose a document (PDF, Word, Excel, CSV, TXT or image, max 25 MB)
      </label>
      <input
        ref={inputRef}
        id={`item-doc-file-${checklistItemId}`}
        type="file"
        accept={ACCEPT}
        disabled={busy}
        className="block w-full text-sm"
      />
      <p className="text-xs text-muted">
        It is saved to the Document Vault folder &ldquo;Checklists &amp; Forms&rdquo; and linked to this item now; it shows
        &ldquo;Pending vault approval&rdquo; until approved there.
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <button type="button" onClick={submit} disabled={busy} className={btn + " w-full bg-burgundy text-white disabled:opacity-60"}>
        {busy ? "Uploading…" : "Upload and attach"}
      </button>
    </div>
  );
}
