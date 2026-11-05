"use client";

import { useActionState, useState } from "react";
import { updateVaultDocumentMetadataAction, type UpdateVaultMetadataState } from "@/lib/vault/document-control-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: UpdateVaultMetadataState = { error: null };

export function EditMetadataForm({
  projectId,
  documentId,
  title,
  reference,
  revision,
  documentDate,
  notes,
  locked,
}: {
  projectId: string;
  documentId: string;
  title: string;
  reference: string;
  revision: string;
  documentDate: string;
  notes: string;
  /** Approved/superseded: reference and revision are read-only (upload a new revision instead). */
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: UpdateVaultMetadataState, formData: FormData) => {
      const result = await updateVaultDocumentMetadataAction(prev, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    initialState
  );
  const keepValuesSubmit1 = useKeepFormValues(state, formAction);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} variant="link">
        <Tx>Edit details</Tx>
      </Button>
    );
  }
  const cls = "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy read-only:bg-off-white";
  return (
    <form onSubmit={keepValuesSubmit1} className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block text-xs text-muted sm:col-span-2">
        <Tx>Title</Tx>
        <input name="title" defaultValue={title} required maxLength={200} className={cls} />
      </label>
      <label className="block text-xs text-muted">
        <Tx>Document reference</Tx>
        <input name="document_reference" defaultValue={reference} readOnly={locked} className={cls} />
      </label>
      <label className="block text-xs text-muted">
        <Tx>Revision</Tx>
        <input name="revision" defaultValue={revision} required readOnly={locked} className={cls} />
      </label>
      <label className="block text-xs text-muted">
        <Tx>Document date</Tx>
        <input name="document_date" type="date" max="9999-12-31" defaultValue={documentDate} className={cls} />
      </label>
      <label className="block text-xs text-muted sm:col-span-2">
        <Tx>Notes</Tx>
        <textarea name="notes" rows={2} defaultValue={notes} className={cls} />
      </label>
      {locked && (
        <p className="text-xs text-muted sm:col-span-2">
          <Tx>Approved: reference and revision are locked.</Tx>
        </p>
      )}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" onClick={() => setOpen(false)} variant="link-muted" size="sm">
          <Tx>Cancel</Tx>
        </Button>
      </div>
      {state.error && (
        <p className="text-xs text-danger sm:col-span-2" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
