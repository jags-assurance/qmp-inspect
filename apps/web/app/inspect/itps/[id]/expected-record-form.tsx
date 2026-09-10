"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  createExpectedRecordAction,
  markExpectedRecordReceivedAction,
} from "@/lib/expected-records/actions";
import type { ActivityExpectedRecordRow, ExpectedRecordProvider } from "@/lib/expected-records/db-types";
import { Button } from "@/components/ui/button";

const PROVIDER_LABEL: Record<ExpectedRecordProvider, string> = {
  jags: "Jags",
  tpi: "TPI / Lab",
  contractor: "Contractor",
};

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
}: {
  itpItemId: string;
  records: ActivityExpectedRecordRow[];
  canAdd: boolean;
  /** Whether the CURRENT user may mark a given provider's row received (staff, or that party's own linked login). */
  canMarkReceivedByProvider: Record<ExpectedRecordProvider, boolean>;
  projectId: string;
}) {
  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-muted">Expected records</h4>
      </div>
      <ul className="mt-2 space-y-1.5">
        {records.map((record) => (
          <ExpectedRecordRow
            key={record.id}
            record={record}
            canMarkReceived={canMarkReceivedByProvider[record.provider]}
            projectId={projectId}
          />
        ))}
        {records.length === 0 && <li className="text-xs text-muted">No expected records listed for this activity.</li>}
      </ul>
      {canAdd && <AddExpectedRecordForm itpItemId={itpItemId} />}
    </div>
  );
}

function ExpectedRecordRow({
  record,
  canMarkReceived,
  projectId,
}: {
  record: ActivityExpectedRecordRow;
  canMarkReceived: boolean;
  projectId: string;
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
          className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isReceived ? "bg-success/10 text-success" : "bg-muted/15 text-muted"
          }`}
        >
          {isReceived ? "Received" : "Pending"}
        </span>
      </div>
      {isReceived ? (
        <p className="mt-1 text-muted">
          Doc no. <span className="doc-id text-ink">{record.document_number}</span>
        </p>
      ) : (
        canMarkReceived && (
          <div className="mt-1">
            {!open ? (
              <button type="button" onClick={() => setOpen(true)} className="text-burgundy hover:underline">
                Mark received →
              </button>
            ) : (
              <MarkReceivedForm record={record} projectId={projectId} onClose={() => setOpen(false)} />
            )}
          </div>
        )
      )}
    </li>
  );
}

function MarkReceivedForm({
  record,
  projectId,
  onClose,
}: {
  record: ActivityExpectedRecordRow;
  projectId: string;
  onClose: () => void;
}) {
  const [documentNumber, setDocumentNumber] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!documentNumber.trim()) {
      setError("A document number is required.");
      return;
    }
    setUploading(true);
    setError(null);

    try {
      let storagePath = "";
      const file = fileRef.current?.files?.[0];
      if (file) {
        const supabase = createSupabaseBrowserClient();
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        storagePath = `expected-records/${projectId}/${record.itp_item_id}/${Date.now()}-${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("inspection-evidence")
          .upload(storagePath, file);
        if (uploadError) throw uploadError;
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
        placeholder="Document number"
        className="doc-id w-full rounded border border-border bg-surface px-2 py-1 text-xs"
      />
      <input ref={fileRef} type="file" className="w-full text-[11px]" />
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={uploading}>
          {uploading ? "Saving…" : "Mark received"}
        </Button>
        <button type="button" onClick={onClose} className="text-[11px] text-muted hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddExpectedRecordForm({ itpItemId }: { itpItemId: string }) {
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
        + Add expected record
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
          placeholder="e.g. Mill certificate"
          className="flex-1 rounded border border-border bg-surface px-2 py-1"
        />
      </div>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-muted hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
