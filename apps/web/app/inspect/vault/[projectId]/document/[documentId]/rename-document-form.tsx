"use client";

import { useActionState, useState } from "react";
import { renameVaultDocumentAction, type RenameVaultDocumentState } from "@/lib/vault/actions";
import { Button } from "@/components/ui/button";

const initialState: RenameVaultDocumentState = { error: null };

export function RenameDocumentForm({ projectId, documentId, title }: { projectId: string; documentId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: RenameVaultDocumentState, formData: FormData) => {
      const result = await renameVaultDocumentAction(prev, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    initialState
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-burgundy hover:underline">
        Rename
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input
        name="title"
        defaultValue={title}
        required
        maxLength={200}
        aria-label="Document title"
        className="w-full sm:min-w-64 rounded-md border border-border bg-surface px-2 py-1 text-sm"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
        Cancel
      </button>
      {state.error && <p role="alert" className="w-full text-xs text-danger">{state.error}</p>}
    </form>
  );
}
