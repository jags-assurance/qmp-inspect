"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createExpectedRecordAction,
  deleteExpectedRecordAction,
  markExpectedRecordReceivedAction,
  updateExpectedRecordAction,
  type ExpectedRecordActionResult,
} from "@/lib/expected-records/actions";
import { EXPECTED_RECORD_PROVIDERS, type ActivityExpectedRecordRow, type ExpectedRecordProvider } from "@/lib/expected-records/db-types";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const PROVIDER_LABEL: Record<ExpectedRecordProvider, string> = {
  jags: "Jags",
  tpi: "TPI / Lab",
  contractor: "Contractor",
};

/** A document already on file in this project's vault — offered as an alternative to a fresh upload
 * when marking an expected record received (R54-R56): a calibration cert or mill certificate is
 * often already stored before the test that needs it even runs, so re-uploading the same file a
 * second time is pure friction. */
export interface VaultDocumentOption {
  id: string;
  title: string;
  documentReference: string | null;
  storagePath: string;
  folderName: string;
  /** 'for_review' | 'approved' | 'superseded' — see supabase/migrations/20260910010000_phase2_
   *  document_vault.sql. Only ExpectedRecordsSection's own picker ignores it (an expected record's
   *  file doesn't need prior approval to be attached); ItpItemEvidenceDocumentsSection's picker
   *  (evidence_type=2 completion evidence) filters to 'approved' only. */
  status: string;
  revision?: string | null;
  createdAt?: string | null;
}

/**
 * R54-R56: the "expected -> received" list of third-party test records for one activity. Staff can
 * add an expected record (provider + record type, number left blank per spec); the provider's own
 * linked party (or staff on their behalf) can later upload the actual file and enter the document
 * number, which marks it received.
 */
export function ExpectedRecordsSection({
  itpItemId,
  records,
  canAdd,
  canMarkReceivedByProvider,
  projectId,
  vaultDocuments,
}: {
  itpItemId: string;
  records: ActivityExpectedRecordRow[];
  canAdd: boolean;
  /** Whether the CURRENT user may mark a given provider's row received (staff, or that party's own linked login). */
  canMarkReceivedByProvider: Record<ExpectedRecordProvider, boolean>;
  projectId: string;
  vaultDocuments: VaultDocumentOption[];
}) {
  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted"><Tx>Expected records</Tx></h4>
      </div>
      <ul className="mt-2 space-y-1.5">
        {records.map((record) => (
          <ExpectedRecordRow
            key={record.id}
            canManage={canAdd}
            record={record}
            canMarkReceived={canMarkReceivedByProvider[record.provider]}
            projectId={projectId}
            vaultDocuments={vaultDocuments}
          />
        ))}
        {records.length === 0 && <li className="text-xs text-muted"><Tx>No expected records listed for this activity.</Tx></li>}
      </ul>
      {canAdd && <AddExpectedRecordForm itpItemId={itpItemId} />}
    </div>
  );
}

function RecordManageControls({ record }: { record: ActivityExpectedRecordRow }) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updating] = useActionState(updateExpectedRecordAction, { error: null } as ExpectedRecordActionResult);
  const [deleteState, deleteAction, deleting] = useActionState(deleteExpectedRecordAction, { error: null } as ExpectedRecordActionResult);
  const { gateSubmit, dialog } = useConfirm();
  const submittedRef = useRef(false);
  useEffect(() => {
    if (submittedRef.current && !updating && updateState.error === null) {
      submittedRef.current = false;
      setEditing(false);
    }
  }, [updating, updateState]);

  if (editing) {
    return (
      <form action={updateAction} onSubmit={() => (submittedRef.current = true)} className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="record_id" value={record.id} />
        <input
          name="record_type"
          defaultValue={record.record_type}
          required
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs"
        />
        <select name="provider" defaultValue={record.provider} className="rounded border border-border bg-surface px-2 py-1 text-xs">
          {EXPECTED_RECORD_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        <button type="submit" disabled={updating} className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-off-white">
          {updating ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted hover:underline">
          <Tx>Cancel</Tx>
        </button>
        {updateState.error && <span className="w-full text-danger">{updateState.error}</span>}
      </form>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <button type="button" onClick={() => setEditing(true)} className="text-xs text-muted hover:underline">
        <Tx>Edit</Tx>
      </button>
      {dialog}
      <form
        action={deleteAction}
        onSubmit={gateSubmit({
          title: "Remove expected record?",
          message: `Remove the expected record "${record.record_type}"?`,
          confirmLabel: "Remove",
          destructive: true,
        })}
      >
        <input type="hidden" name="record_id" value={record.id} />
        <button type="submit" disabled={deleting} className="text-xs text-danger hover:underline">
          {deleting ? "Removing…" : "Remove"}
        </button>
      </form>
      {deleteState.error && <span className="text-danger">{deleteState.error}</span>}
    </div>
  );
}

function ExpectedRecordRow({
  record,
  canManage,
  canMarkReceived,
  projectId,
  vaultDocuments,
}: {
  record: ActivityExpectedRecordRow;
  canManage: boolean;
  canMarkReceived: boolean;
  projectId: string;
  vaultDocuments: VaultDocumentOption[];
}) {
  const [open, setOpen] = useState(false);
  const isReceived = record.received_at != null;

  return (
    <li className="rounded border border-border px-2 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink">
          {record.record_type} <span className="text-muted">· {PROVIDER_LABEL[record.provider]}</span>
        </span>
        <span
          className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium ${
            isReceived ? "bg-success/10 text-success" : "bg-muted/15 text-muted"
          }`}
        >
          {isReceived ? "Received" : "Pending"}
        </span>
      </div>
      {isReceived ? (
        <p className="mt-1 text-muted">
          <Tx>Doc no.</Tx> <span className="doc-id text-ink">{record.document_number}</span>
        </p>
      ) : (
        <>
        {canManage && <RecordManageControls record={record} />}
        {canMarkReceived && (
          <div className="mt-1">
            {!open ? (
              <button type="button" onClick={() => setOpen(true)} className="text-burgundy hover:underline">
                <Tx>Mark received →</Tx>
              </button>
            ) : (
              <MarkReceivedForm
                record={record}
                projectId={projectId}
                vaultDocuments={vaultDocuments}
                onClose={() => setOpen(false)}
              />
            )}
          </div>
        )}
        </>
      )}
    </li>
  );
}

function MarkReceivedForm({
  record,
  projectId,
  vaultDocuments,
  onClose,
}: {
  record: ActivityExpectedRecordRow;
  projectId: string;
  vaultDocuments: VaultDocumentOption[];
  onClose: () => void;
}) {
  const tl = useTranslate();
  const [source, setSource] = useState<"upload" | "vault">(vaultDocuments.length > 0 ? "vault" : "upload");
  const [documentNumber, setDocumentNumber] = useState("");
  const [vaultDocumentId, setVaultDocumentId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function onVaultDocumentChange(id: string) {
    setVaultDocumentId(id);
    // The document number is required either way — pre-fill from the vault doc's own reference so
    // the inspector isn't re-typing something already on file, but still editable (a vault
    // document_reference and the record's actual document number aren't always the same thing).
    if (!documentNumber.trim()) {
      const doc = vaultDocuments.find((d) => d.id === id);
      if (doc?.documentReference) setDocumentNumber(doc.documentReference);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!documentNumber.trim()) {
      setError("A document number is required.");
      return;
    }
    if (source === "vault" && !vaultDocumentId) {
      setError("Choose a document from the vault, or switch to uploading a new file.");
      return;
    }
    setUploading(true);
    setError(null);

    try {
      let storagePath = "";
      if (source === "vault") {
        storagePath = vaultDocuments.find((d) => d.id === vaultDocumentId)?.storagePath ?? "";
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          setError("Choose the file to upload, or switch to attaching one from the vault.");
          setUploading(false);
          return;
        }
        {
          const supabase = createSupabaseBrowserClient();
          const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
          storagePath = `expected-records/${projectId}/${record.itp_item_id}/${Date.now()}-${safeName}`;
          const { error: uploadError } = await supabase.storage
            .from("inspection-evidence")
            .upload(storagePath, file);
          if (uploadError) throw uploadError;
        }
      }

      const formData = new FormData();
      formData.set("record_id", record.id);
      formData.set("document_number", documentNumber.trim());
      formData.set("storage_path", storagePath);
      const result = await markExpectedRecordReceivedAction({ error: null }, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Could not upload the file. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1.5 space-y-1.5 rounded border border-border bg-off-white p-2">
      <input
        value={documentNumber}
        onChange={(e) => setDocumentNumber(e.target.value)}
        placeholder={tl("Document number")}
        className="doc-id w-full rounded border border-border bg-surface px-2 py-1 text-xs"
      />

      {vaultDocuments.length > 0 && (
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setSource("vault")}
            className={`rounded px-2 py-1 font-medium ${source === "vault" ? "bg-burgundy text-white" : "border border-border bg-surface text-ink"}`}
          >
            <Tx>Attach from vault</Tx>
          </button>
          <button
            type="button"
            onClick={() => setSource("upload")}
            className={`rounded px-2 py-1 font-medium ${source === "upload" ? "bg-burgundy text-white" : "border border-border bg-surface text-ink"}`}
          >
            <Tx>Upload new file</Tx>
          </button>
        </div>
      )}

      {source === "vault" ? (
        <select
          value={vaultDocumentId}
          onChange={(e) => onVaultDocumentChange(e.target.value)}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs"
        >
          <option value=""><Tx>Select a document already in the vault…</Tx></option>
          {[...new Set(vaultDocuments.map((d) => d.folderName))].sort().map((folder) => (
            <optgroup key={folder} label={folder}>
              {vaultDocuments
                .filter((d) => d.folderName === folder)
                .map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                    {doc.documentReference ? ` (${doc.documentReference})` : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      ) : (
        <input ref={fileRef} type="file" className="w-full text-xs" />
      )}

      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={uploading}>
          {uploading ? "Saving…" : "Mark received"}
        </Button>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:underline">
          <Tx>Cancel</Tx>
        </button>
      </div>
    </form>
  );
}

function AddExpectedRecordForm({ itpItemId }: { itpItemId: string }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [recordType, setRecordType] = useState("");
  const [provider, setProvider] = useState<ExpectedRecordProvider>("tpi");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-medium text-burgundy hover:underline"
      >
        <Tx>+ Add expected record</Tx>
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recordType.trim()) {
      setError("Record type is required.");
      return;
    }
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("itp_item_id", itpItemId);
    formData.set("provider", provider);
    formData.set("record_type", recordType.trim());
    const result = await createExpectedRecordAction({ error: null }, formData);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRecordType("");
    setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-1.5 rounded border border-border bg-off-white p-2 text-xs">
      <div className="flex gap-1.5">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ExpectedRecordProvider)}
          className="rounded border border-border bg-surface px-2 py-1"
        >
          {Object.entries(PROVIDER_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          value={recordType}
          onChange={(e) => setRecordType(e.target.value)}
          placeholder={tl("e.g. Mill certificate")}
          className="flex-1 rounded border border-border bg-surface px-2 py-1"
        />
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:underline">
          <Tx>Cancel</Tx>
        </button>
      </div>
    </form>
  );
}
