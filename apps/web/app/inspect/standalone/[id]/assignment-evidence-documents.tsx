"use client";

import { useActionState, useState } from "react";
import {
  linkAssignmentEvidenceDocumentAction,
  unlinkAssignmentEvidenceDocumentAction,
  type LinkEvidenceDocumentState,
  type StandaloneAssignmentEvidenceDocumentRow,
} from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { VaultFilePicker } from "@/components/domain/vault-file-picker";

const initialState: LinkEvidenceDocumentState = { error: null };

export interface VaultDocumentOption {
  id: string;
  title: string;
  documentReference: string | null;
  folderName: string;
}

/**
 * Links existing vault documents as this standalone assignment's own evidence — the gap flagged
 * live: only photos and signatures existed, with no way to attach a controlled document (a spec
 * sheet, a client-supplied drawing, a prior certificate). Mirrors
 * ItpItemEvidenceDocumentsSection's exact pattern (upload to the project's Vault first, link here).
 */
export function AssignmentEvidenceDocuments({
  assignmentId,
  documents,
  vaultDocuments,
  canEdit,
}: {
  assignmentId: string;
  documents: (StandaloneAssignmentEvidenceDocumentRow & { title: string; documentReference: string | null })[];
  vaultDocuments: VaultDocumentOption[];
  canEdit: boolean;
}) {
  const linkedIds = new Set(documents.map((d) => d.vault_document_id));
  const availableDocuments = vaultDocuments.filter((d) => !linkedIds.has(d.id));

  return (
    <div className="p-4">
      <ul className="space-y-1.5">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between rounded border border-border px-3 py-2 text-sm">
            <span className="text-ink">
              {doc.title}
              {doc.documentReference && <span className="text-muted"> ({doc.documentReference})</span>}
            </span>
            {canEdit && (
              <form action={unlinkAssignmentEvidenceDocumentAction}>
                <input type="hidden" name="assignment_id" value={assignmentId} />
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
      {canEdit && <LinkDocumentForm assignmentId={assignmentId} availableDocuments={availableDocuments} />}
    </div>
  );
}

function LinkDocumentForm({ assignmentId, availableDocuments }: { assignmentId: string; availableDocuments: VaultDocumentOption[] }) {
  const [state, formAction, pending] = useActionState(linkAssignmentEvidenceDocumentAction, initialState);
  const [open, setOpen] = useState(false);

  if (availableDocuments.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted">
        Upload the evidence document to the project&rsquo;s Document Vault first, then link it here.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-burgundy hover:underline">
        + Link evidence document
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-2 rounded-md border border-border bg-off-white p-3 text-sm">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <VaultFilePicker documents={availableDocuments} />
      {state.error && <p className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Linking…" : "Link selected files"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
