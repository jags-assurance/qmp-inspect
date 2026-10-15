"use client";

import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { issueHandoverAction } from "@/lib/handover/actions";
import { sha256HexOfBlob } from "@/lib/databook/sha256-stream";
import { uploadWithResume } from "@/lib/storage/upload-client";
import { Button } from "@/components/ui/button";
import { ConfirmTypeDialog } from "@/components/domain/confirm-type-dialog";
import { MoreDetails } from "@/components/domain/more-details";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/** Storage keys must be plain ASCII: keep the readable part, replace the rest. The ORIGINAL file name
 *  (Arabic, Chinese, ...) is recorded in the certificate notes instead of being lost as "____.pdf". */
function storageSafeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12) : "";
  const stem = (dot > 0 ? name.slice(0, dot) : name).normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return `${stem || "package"}${ext}`;
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Same client-upload-then-record split as vault/[projectId]/[folderId]/upload-form.tsx: the package
 * file goes straight from the browser to the generated-documents bucket, then the server action is
 * called directly (not via a plain <form action>, since the storage path is only known after the
 * upload completes) — issueHandoverAction refuses to issue a certificate without one.
 *
 * Also computes and stores a SHA-256 fingerprint of the package at issue time (an immutable
 * handover snapshot, in miniature): once issued, the Handover Portal shows this hash next to the
 * download link, so anyone who receives the file separately (e.g. forwarded by email) can verify
 * their copy is byte-for-byte the one that was actually certified, not a since-modified version.
 * The hash is computed in slices (a package of 1 GB+ must not be loaded into memory at once) and the
 * form confirms the irreversible issue before anything is uploaded.
 */
export function IssueHandoverForm({
  projectId,
  dataBookId,
  bookNumber,
  isConditional = false,
}: {
  projectId: string;
  dataBookId: string;
  bookNumber: string;
  isConditional?: boolean;
}) {
  const tl = useTranslate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ file: File; formData: FormData } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("package_file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("Choose the handover package file to upload.");
      return;
    }
    if (file.size === 0) {
      setError("The selected file is empty.");
      return;
    }
    // Snapshot the fields BEFORE disabling them: disabled inputs are left out of FormData, so building
    // it after setPending(true) (as this used to) dropped the certificate number and every issue
    // attempt failed with "Certificate number is required."
    setError(null);
    setNotice(null);
    setConfirming({ file, formData: new FormData(form) });
  }

  async function issue(file: File, formData: FormData) {
    setConfirming(null);
    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const path = `handover/${dataBookId}/${Date.now()}-${storageSafeName(file.name)}`;

    setStatus("Fingerprinting the package (0%)…");
    let sha256: string;
    try {
      sha256 = await sha256HexOfBlob(file, (f) => setStatus(`Fingerprinting the package (${Math.round(f * 100)}%)…`));
    } catch {
      setError("Could not read the selected file to fingerprint it. Choose it again and retry.");
      setPending(false);
      setStatus(null);
      return;
    }

    setStatus(`Uploading ${formatBytes(file.size)}…`);
    // Resumable (TUS) for large packages, with a plain-upload fallback (S7-21).
    const { error: uploadError } = await uploadWithResume(supabase, {
      bucket: "generated-documents",
      path,
      file,
      onProgress: (f) => setStatus(`Uploading ${formatBytes(file.size)} (${Math.round(f * 100)}%)…`),
    });
    if (uploadError) {
      setError("Package upload failed. Check your connection and try again.");
      setPending(false);
      setStatus(null);
      return;
    }

    setStatus("Issuing the certificate…");
    // The file already went to storage; never send its bytes through the server action as well.
    formData.delete("package_file");
    formData.set("data_book_id", dataBookId);
    formData.set("project_id", projectId);
    formData.set("package_storage_path", path);
    formData.set("package_sha256", sha256);
    // Keep the original (possibly non-ASCII) file name with the certificate.
    const typedNotes = String(formData.get("handover_notes") ?? "").trim();
    formData.set("handover_notes", [typedNotes, `Package file: ${file.name} (${formatBytes(file.size)})`].filter(Boolean).join("\n"));

    const result = await issueHandoverAction({ error: null }, formData);
    if (result.error) {
      setError(result.error);
    } else {
      if (result.notice) setNotice(result.notice);
      formRef.current?.reset();
    }
    setPending(false);
    setStatus(null);
  }

  return (
    <>
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`package_file_${dataBookId}`} className="block text-xs font-medium text-ink">
            <Tx>Package file</Tx>
          </label>
          <input
            id={`package_file_${dataBookId}`}
            name="package_file"
            type="file"
            required
            disabled={pending}
            className="mt-1 block text-sm text-ink file:me-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
          />
        </div>

        <div className="w-full">
          <MoreDetails label="Optional: reference and notes" bare className="mt-0">
            <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`certificate_number_${dataBookId}`} className="block text-xs font-medium text-ink">
            <Tx>Certificate reference (optional)</Tx>
          </label>
          <input
            id={`certificate_number_${dataBookId}`}
            name="certificate_number"
            maxLength={60}
            placeholder={tl("blank = next HC-###")}
            disabled={pending}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none sm:text-sm [@media(pointer:coarse)]:min-h-11 focus:border-burgundy disabled:opacity-50 sm:w-40"
          />
        </div>

        <div className="w-full">
          <label htmlFor={`handover_notes_${dataBookId}`} className="block text-xs font-medium text-ink">
            <Tx>Notes for the certificate (optional)</Tx>
          </label>
          <textarea
            id={`handover_notes_${dataBookId}`}
            name="handover_notes"
            rows={2}
            maxLength={1500}
            disabled={pending}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none sm:text-sm [@media(pointer:coarse)]:min-h-11 focus:border-burgundy disabled:opacity-50"
          />
        </div>

            </div>
          </MoreDetails>
        </div>

        <StickyActionBar className="w-full">
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Issuing…" : "Issue for handover"}
        </Button>
        </StickyActionBar>

        {status && (
          <p className="w-full text-xs text-muted" role="status" aria-live="polite">
            {status}
          </p>
        )}
        {error && <p className="w-full text-sm text-danger" role="alert">{error}</p>}
        {notice && <p className="w-full text-sm text-warning" role="status">{notice}</p>}
      </form>

      {confirming && (
        <ConfirmTypeDialog
          title={tl("Issue this handover to the client?")}
          phrase={bookNumber}
          confirmLabel="Issue handover"
          onCancel={() => setConfirming(null)}
          onConfirm={() => void issue(confirming.file, confirming.formData)}
        >
          <p>
            <Tx>This certifies Data Book</Tx> <strong>{bookNumber}</strong> <Tx>and the package</Tx> <strong>{confirming.file.name}</strong> ({formatBytes(confirming.file.size)}<Tx>) and makes both visible to the client. It cannot be undone.</Tx>
          </p>
          {isConditional && <p className="text-warning"><Tx>This is a Conditional Handover: the open items recorded at compile time will be listed on the certificate.</Tx></p>}
          <p className="text-xs text-muted"><Tx>The client will be notified and asked to acknowledge receipt.</Tx></p>
        </ConfirmTypeDialog>
      )}
    </>
  );
}
