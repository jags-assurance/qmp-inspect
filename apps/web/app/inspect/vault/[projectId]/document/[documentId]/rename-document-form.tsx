"use client";

import { useActionState, useState } from "react";
import { renameVaultDocumentAction, type RenameVaultDocumentState } from "@/lib/vault/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: RenameVaultDocumentState = { error: null };

export function RenameDocumentForm({ projectId, documentId, title }: { projectId: string; documentId: string; title: string }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: RenameVaultDocumentState, formData: FormData) => {
      const result = await renameVaultDocumentAction(prev, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    initialState
  );
  const keepValuesSubmit1 = useKeepFormValues(state, formAction);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} variant="link" size="sm">
        <Tx>Rename</Tx>
      </Button>
    );
  }
  return (
    <form onSubmit={keepValuesSubmit1} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input
        name="title"
        defaultValue={title}
        required
        maxLength={200}
        aria-label={tl("Document title")}
        className="w-full sm:min-w-64 rounded-md border border-border bg-surface px-2 py-1 text-sm"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" onClick={() => setOpen(false)} variant="link-muted" size="sm">
        <Tx>Cancel</Tx>
      </Button>
      {state.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
