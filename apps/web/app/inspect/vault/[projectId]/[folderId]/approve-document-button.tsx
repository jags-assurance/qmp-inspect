"use client";

import { useActionState } from "react";
import { approveVaultDocumentAction, type ApproveVaultDocumentState } from "@/lib/vault/actions";

const initialState: ApproveVaultDocumentState = { error: null };

export function ApproveDocumentButton({
  documentId,
  projectId,
  folderId,
}: {
  documentId: string;
  projectId: string;
  folderId: string;
}) {
  const [state, formAction, pending] = useActionState(approveVaultDocumentAction, initialState);

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="folder_id" value={folderId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Approving…" : "Approve"}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
