"use client";

import { useActionState, useState } from "react";
import {
  linkInspectionEvidenceDocumentAction,
  unlinkInspectionEvidenceDocumentAction,
  type LinkInspectionEvidenceDocumentState,
} from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";

const initialState: LinkInspectionEvidenceDocumentState = { error: null };

export interface VaultDocumentOption {
  id: string;
  title: string;
  documentReference: string | null;
  folderName: string;
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
  canEdit,
}: {
  inspectionRecordId: string;
  documents: InspectionEvidenceDocumentItem[];
  vaultDocuments: VaultDocumentOption[];
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
                  Unlink
                </button>
              </form>
            )}
          </li>
        ))}
        {documents.length === 0 && <li className="text-sm text-muted">No evidence documents linked yet.</li>}
      </ul>
      {canEdit && (
        <LinkDocumentForm inspectionRecordId={inspectionRecordId} availableDocuments={availableDocuments} />
      )}
    </div>
  );
}

function LinkDocumentForm({
  inspectionRecordId,
  availableDocuments,
}: {
  inspectionRecordId: string;
  availableDocuments: VaultDocumentOption[];
}) {
  const [state, formAction, pending] = useActionState(linkInspectionEvidenceDocumentAction, initialState);
  const [open, setOpen] = useState(false);

  if (availableDocuments.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted">
        Upload the evidence document to the project&rsquo;s Document Vault first, then link it here.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm font-medium text-burgundy hover:underline">
        + Link from Document Vault
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-border bg-off-white p-3 text-sm">
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <select name="vault_document_id" required defaultValue="" className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm">
        <option value="">Select a document from the vault…</option>
        {availableDocuments.map((doc) => (
          <option key={doc.id} value={doc.id}>
            {doc.folderName} — {doc.title}
            {doc.documentReference ? ` (${doc.documentReference})` : ""}
          </option>
        ))}
      </select>
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Linking…" : "Link"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
