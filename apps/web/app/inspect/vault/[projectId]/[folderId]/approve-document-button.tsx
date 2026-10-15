"use client";

import { useActionState, useState } from "react";
import { approveDocumentAction, type ApproveDocumentState } from "@/lib/vault/multi-approval-actions";
import { Button } from "@/components/ui/button";

const initialState: ApproveDocumentState = { error: null };

export function ApproveDocumentButton({
  documentId,
  projectId,
  folderId,
  canApproveGenerally,
  label = "Approve",
  uploadedByMe = false,
  isAdmin = false,
}: {
  documentId: string;
  projectId: string;
  folderId: string;
  /** Whether THIS viewer holds the general approve_vault_document permission/Admin — the fallback
   *  path used only when the document has no configured approver list. A named approver with
   *  neither still gets to click their own step. */
  canApproveGenerally: boolean;
  label?: string;
  /** The viewer uploaded this revision: they cannot approve it (segregation of duties). */
  uploadedByMe?: boolean;
  /** Admins may override with a written reason. */
  isAdmin?: boolean;
}) {
  const [state, formAction, pending] = useActionState(approveDocumentAction, initialState);
  const [asking, setAsking] = useState(false);

  if (uploadedByMe && !isAdmin) {
    return <span className="text-xs text-muted">You uploaded this, so someone else must approve it.</span>;
  }

  return (
    <form action={formAction} className="inline-flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="folder_id" value={folderId} />
      <input type="hidden" name="can_approve_generally" value={canApproveGenerally ? "true" : "false"} />
      {uploadedByMe && isAdmin ? (
        <>
          <span className="text-xs text-muted">You uploaded this. Admin override needs a reason.</span>
          {asking ? (
            <input
              name="override_reason"
              required
              minLength={10}
              placeholder="Reason (min 10 characters)"
              aria-label="Admin override reason"
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            />
          ) : null}
          {asking ? (
            <Button
              type="submit"
              disabled={pending}
              variant="outline" size="sm"
            >
              {pending ? "Approving…" : "Approve as admin"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => setAsking(true)}
              variant="outline" size="sm"
            >
              Approve as admin (reason)
            </Button>
          )}
        </>
      ) : asking ? (
        <>
          <input
            name="approval_comment"
            required
            minLength={5}
            autoFocus
            placeholder="Approval comment (required)"
            aria-label="Approval comment"
            className="min-w-48 rounded-md border border-border bg-surface px-2 py-1 text-xs"
          />
          <Button
            type="submit"
            disabled={pending}
            variant="outline" size="sm"
          >
            {pending ? "Approving…" : "Confirm approve"}
          </Button>
          <Button type="button" onClick={() => setAsking(false)} variant="link-muted" size="sm">
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          onClick={() => setAsking(true)}
          variant="outline" size="sm"
        >
          {label}
        </Button>
      )}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
