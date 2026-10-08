"use client";

import { useActionState, useState } from "react";
import { rejectDocumentAction, type RejectDocumentState } from "@/lib/vault/multi-approval-actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: RejectDocumentState = { error: null };

export function RejectDocumentButton({ documentId, projectId, folderId }: { documentId: string; projectId: string; folderId: string }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(rejectDocumentAction, initialState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-danger hover:bg-off-white"
      >
        <Tx>Reject</Tx>
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="folder_id" value={folderId} />
      <input
        name="reason"
        required
        minLength={5}
        placeholder={tl("Reason for rejecting")}
        aria-label={tl("Reason for rejecting")}
        className="w-48 rounded-md border border-border bg-surface px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-danger bg-surface px-2 py-1 text-xs font-medium text-danger hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Rejecting…" : "Confirm reject"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
        <Tx>Cancel</Tx>
      </button>
      {state.error && <span className="w-full text-xs text-danger">{state.error}</span>}
    </form>
  );
}
