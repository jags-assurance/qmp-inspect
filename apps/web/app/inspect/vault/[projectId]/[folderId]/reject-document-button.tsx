"use client";

import { useActionState, useState } from "react";
import { rejectDocumentAction, type RejectDocumentState } from "@/lib/vault/multi-approval-actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: RejectDocumentState = { error: null };

export function RejectDocumentButton({ documentId, projectId, folderId }: { documentId: string; projectId: string; folderId: string }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(rejectDocumentAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="danger-outline" size="sm"
      >
        <Tx>Reject</Tx>
      </Button>
    );
  }

  return (
    <form onSubmit={keepValuesSubmit} className="flex flex-wrap items-center gap-1.5">
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
      <Button
        type="submit"
        disabled={pending}
        variant="danger-outline" size="sm"
      >
        {pending ? "Rejecting…" : "Confirm reject"}
      </Button>
      <Button type="button" onClick={() => setOpen(false)} variant="link-muted" size="sm">
        <Tx>Cancel</Tx>
      </Button>
      {state.error && <span className="w-full text-xs text-danger">{state.error}</span>}
    </form>
  );
}
