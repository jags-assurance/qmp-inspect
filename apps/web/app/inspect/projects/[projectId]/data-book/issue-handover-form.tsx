"use client";

import { useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { issueHandoverAction } from "@/lib/handover/actions";
import { Button } from "@/components/ui/button";

/**
 * Same client-upload-then-record split as vault/[projectId]/[folderId]/upload-form.tsx: the package
 * file goes straight from the browser to the generated-documents bucket, then the server action is
 * called directly (not via a plain <form action>, since the storage path is only known after the
 * upload completes) — issueHandoverAction refuses to issue a certificate without one.
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

    setPending(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `handover/${dataBookId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from("generated-documents").upload(path, file);
    if (uploadError) {
      setError("Package upload failed. Check your connection and try again.");
      setPending(false);
      return;
    }

    const formData = new FormData(form);
    formData.set("data_book_id", dataBookId);
    formData.set("project_id", projectId);
    formData.set("package_storage_path", path);

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
          Certificate number
        </label>
        <input
          id={`certificate_number_${dataBookId}`}
          name="certificate_number"
          required
          placeholder="e.g. HC-001"
          disabled={pending}
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy disabled:opacity-50"
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
