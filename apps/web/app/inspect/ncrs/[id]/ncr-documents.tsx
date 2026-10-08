"use client";

import { useActionState, useState, useTransition } from "react";
import { linkNcrDocumentAction, unlinkNcrDocumentAction, type NcrDocumentState } from "@/lib/ncrs/actions";
import { VaultFilePicker, type VaultPickerDocument } from "@/components/domain/vault-file-picker";
import { Tx } from "@/components/domain/tx";

export interface NcrLinkedDocument {
  linkId: string;
  vaultDocumentId: string;
  title: string;
  documentReference: string | null;
  status: string;
}

const btn = "inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium";

export function NcrDocuments({
  ncrId,
  projectId,
  documents,
  vaultOptions,
  readOnly,
}: {
  ncrId: string;
  projectId: string;
  documents: NcrLinkedDocument[];
  vaultOptions: VaultPickerDocument[];
  readOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removing, startRemove] = useTransition();
  const linked = new Set(documents.map((d) => d.vaultDocumentId));
  const available = vaultOptions.filter((d) => !linked.has(d.id));
  const [state, action, pending] = useActionState(
    async (prev: NcrDocumentState, fd: FormData) => {
      const r = await linkNcrDocumentAction(prev, fd);
      if (!r.error) setOpen(false);
      return r;
    },
    { error: null } as NcrDocumentState
  );

  return (
    <div className="space-y-2">
      {documents.length === 0 && <p className="text-sm text-muted"><Tx>No documents linked yet.</Tx></p>}
      {documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map((d) => (
            <li key={d.linkId} className="flex flex-wrap items-center gap-2 rounded border border-border px-3 py-1.5 text-sm">
              <a
                href={`/inspect/vault/${projectId}/document/${d.vaultDocumentId}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 text-burgundy hover:underline [overflow-wrap:anywhere]"
              >
                {d.title}
                {d.documentReference && <span className="text-muted"> ({d.documentReference})</span>}
              </a>
              {!readOnly && (
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    startRemove(async () => {
                      const r = await unlinkNcrDocumentAction({ ncrId, linkId: d.linkId });
                      setRemoveError(r.error);
                    })
                  }
                  className="min-h-11 px-2 text-xs text-danger hover:underline disabled:opacity-60"
                >
                  <Tx>Remove</Tx>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {removeError && (
        <p role="alert" className="text-xs text-danger">
          {removeError}
        </p>
      )}
      {!readOnly && !open && (
        <button type="button" onClick={() => setOpen(true)} className={btn + " text-muted hover:bg-off-white"}>
          <Tx>+ Link document from vault</Tx>
        </button>
      )}
      {!readOnly && open && (
        <form action={action} className="space-y-2 rounded-md border border-border bg-off-white p-3">
          <input type="hidden" name="ncr_id" value={ncrId} />
          {available.length === 0 ? (
            <p className="text-sm text-muted"><Tx>No approved files in this project&apos;s Document Vault are available to link.</Tx></p>
          ) : (
            <VaultFilePicker documents={available} projectId={projectId} />
          )}
          {state.error && (
            <p role="alert" className="text-xs text-danger">
              {state.error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending || available.length === 0}
              className={btn + " flex-1 bg-burgundy text-white disabled:opacity-60"}
            >
              {pending ? "Linking..." : "Link selected files"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={btn}>
              <Tx>Cancel</Tx>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
