"use client";

import { useActionState, useState } from "react";
import {
  linkInspectionEvidenceDocumentAction,
  unlinkInspectionEvidenceDocumentAction,
  type LinkInspectionEvidenceDocumentState,
} from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";
import { VaultFilePicker, type VaultPickerFolder } from "@/components/domain/vault-file-picker";
import { Tx } from "@/components/domain/tx";

const initialState: LinkInspectionEvidenceDocumentState = { error: null };

export interface VaultDocumentOption {
  id: string;
  title: string;
  documentReference: string | null;
  folderName: string;
  revision?: string | null;
  status?: string | null;
  createdAt?: string | null;
  fileType?: string | null;
  storagePath?: string | null;
}

export interface InspectionEvidenceDocumentItem {
  id: string;
  vaultDocumentId: string;
  title: string;
  documentReference: string | null;
}

/**
 * Links existing Document Vault files as this inspection's own evidence — the gap flagged live:
 * photo evidence was device-upload only, with no way to attach a controlled document (a prior
 * cert, a client-supplied drawing). Mirrors AssignmentEvidenceDocuments/
 * ItpItemEvidenceDocumentsSection's exact pattern (upload to the project's Vault first, link here).
 */
export function InspectionEvidenceDocuments({
  inspectionRecordId,
  documents,
  vaultDocuments,
  projectId,
  vaultFolders = [],
  canEdit,
}: {
  inspectionRecordId: string;
  documents: InspectionEvidenceDocumentItem[];
  vaultDocuments: VaultDocumentOption[];
  projectId?: string;
  vaultFolders?: VaultPickerFolder[];
  canEdit: boolean;
}) {
  const linkedIds = new Set(documents.map((d) => d.vaultDocumentId));
  const availableDocuments = vaultDocuments.filter((d) => !linkedIds.has(d.id));

  return (
    <div>
      <ul className="space-y-1.5">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
            <span className="text-ink">
              {doc.title}
              {doc.documentReference && <span className="text-muted"> ({doc.documentReference})</span>}
            </span>
            {canEdit && (
              <form action={unlinkInspectionEvidenceDocumentAction}>
                <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
                <input type="hidden" name="link_id" value={doc.id} />
                <button type="submit" className="text-xs text-danger hover:underline">
                  <Tx>Unlink</Tx>
                </button>
              </form>
            )}
          </li>
        ))}
        {documents.length === 0 && <li className="text-sm text-muted"><Tx>No evidence documents linked yet.</Tx></li>}
      </ul>
      {canEdit && (
        <LinkDocumentForm
          inspectionRecordId={inspectionRecordId}
          availableDocuments={availableDocuments}
          projectId={projectId}
          folders={vaultFolders}
        />
      )}
    </div>
  );
}

function LinkDocumentForm({
  inspectionRecordId,
  availableDocuments,
  projectId,
  folders,
}: {
  inspectionRecordId: string;
  availableDocuments: VaultDocumentOption[];
  projectId?: string;
  folders: VaultPickerFolder[];
}) {
  const [state, formAction, pending] = useActionState(linkInspectionEvidenceDocumentAction, initialState);
  const [open, setOpen] = useState(false);

  if (availableDocuments.length === 0 && (!projectId || folders.length === 0)) {
    return (
      <p className="mt-2 text-xs text-muted">
        <Tx>Upload the evidence document to the project&rsquo;s Document Vault first, then link it here.</Tx>
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm font-medium text-burgundy hover:underline">
        <Tx>+ Link from Document Vault</Tx>
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-border bg-off-white p-3 text-sm">
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <VaultFilePicker documents={availableDocuments} projectId={projectId} folders={folders} allowUpload />
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Linking…" : "Link selected files"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
          <Tx>Cancel</Tx>
        </button>
      </div>
    </form>
  );
}
