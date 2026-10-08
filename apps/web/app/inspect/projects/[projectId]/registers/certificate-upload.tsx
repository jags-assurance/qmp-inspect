"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Tx } from "@/components/domain/tx";

const MAX_MB = 20;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx";

/**
 * Attaches a certificate (MTC, calibration certificate, WPQ…) to a register entry. The file goes
 * straight to storage under <project>/registers/<kind>/…, and its path is posted with the form via a
 * hidden `certificate_path` field. Optional.
 */
export function CertificateUpload({ projectId, kind, label = "Certificate (optional)" }: { projectId: string; kind: string; label?: string }) {
  const [path, setPath] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) {
      setPath("");
      setFileName("");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    const supabase = createSupabaseBrowserClient();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${projectId}/registers/${kind}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("inspection-evidence").upload(storagePath, file);
    setUploading(false);
    if (uploadError) {
      setError("Upload failed — check your connection and try again.");
      setPath("");
      return;
    }
    setPath(storagePath);
    setFileName(file.name);
  }

  return (
    <div className="min-w-48">
      <label className="block text-xs font-medium text-ink">{label}</label>
      <input type="hidden" name="certificate_path" value={path} />
      <input
        type="file"
        accept={ACCEPT}
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="mt-1 block w-full text-xs text-ink file:me-2 file:rounded-md file:border file:border-border file:bg-surface file:px-2 file:py-1 file:text-xs"
      />
      <div role="status" aria-live="polite" aria-atomic="true">
        {uploading ? <p className="mt-0.5 text-xs text-muted"><Tx>Uploading…</Tx></p> : null}
        {path && !uploading ? <p className="mt-0.5 text-xs text-success"><Tx>✓ Attached:</Tx> {fileName}</p> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {error ? <p className="mt-0.5 text-xs text-danger">{error}</p> : null}
      </div>
    </div>
  );
}
