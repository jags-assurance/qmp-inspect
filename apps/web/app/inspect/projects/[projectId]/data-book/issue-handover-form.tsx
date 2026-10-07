"use client";

import { useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { issueHandoverAction } from "@/lib/handover/actions";
import { Button } from "@/components/ui/button";

/** SHA-256 of the file's exact bytes, hex-encoded — computed client-side before upload so the
 *  fingerprint reflects what was actually selected, not anything that could change in transit. */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
 */
export function IssueHandoverForm({ projectId, dataBookId }: { projectId: string; dataBookId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("package_file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      setError("Choose the handover package file to upload.");
      return;
    }

    // Snapshot the fields BEFORE disabling them: disabled inputs are left out of FormData, so building
    // it after setPending(true) (as this used to) dropped the certificate number and every issue
    // attempt failed with "Certificate number is required."
    const formData = new FormData(form);

    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `handover/${dataBookId}/${Date.now()}-${safeName}`;

    const [sha256, { error: uploadError }] = await Promise.all([
      sha256Hex(file),
      supabase.storage.from("generated-documents").upload(path, file),
    ]);
    if (uploadError) {
      setError("Package upload failed. Check your connection and try again.");
      setPending(false);
      return;
    }

    formData.set("data_book_id", dataBookId);
    formData.set("project_id", projectId);
    formData.set("package_storage_path", path);
    formData.set("package_sha256", sha256);

    const result = await issueHandoverAction({ error: null }, formData);
    if (result.error) {
      setError(result.error);
    } else {
      formRef.current?.reset();
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor={`certificate_number_${dataBookId}`} className="block text-xs font-medium text-ink">
          Certificate reference (optional)
        </label>
        <input
          id={`certificate_number_${dataBookId}`}
          name="certificate_number"
          maxLength={60}
          placeholder="e.g. HC-001"
          disabled={pending}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy disabled:opacity-50 sm:w-40"
        />
      </div>

      <div>
        <label htmlFor={`package_file_${dataBookId}`} className="block text-xs font-medium text-ink">
          Package file
        </label>
        <input
          id={`package_file_${dataBookId}`}
          name="package_file"
          type="file"
          required
          disabled={pending}
          className="mt-1 block text-sm text-ink file:mr-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs file:font-medium file:text-ink hover:file:bg-off-white disabled:opacity-50"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Issuing…" : "Issue for handover"}
      </Button>

      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
