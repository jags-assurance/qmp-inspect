"use client";

import { useActionState } from "react";
import { approveDocumentAction, type ApproveDocumentState } from "@/lib/vault/multi-approval-actions";

const initialState: ApproveDocumentState = { error: null };

export function ApproveDocumentButton({
  documentId,
  projectId,
  folderId,
  canApproveGenerally,
  label = "Approve",
}: {
  documentId: string;
  projectId: string;
  folderId: string;
  /** Whether THIS viewer holds the general approve_vault_document permission/Admin — the fallback
   *  path used only when the document has no configured approver list. A named approver with
   *  neither still gets to click their own step. */
  canApproveGenerally: boolean;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(approveDocumentAction, initialState);

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="folder_id" value={folderId} />
      <input type="hidden" name="can_approve_generally" value={canApproveGenerally ? "true" : "false"} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Approving…" : label}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
