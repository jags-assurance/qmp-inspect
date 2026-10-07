// Browser-side upload helper (S7-21): resumable (TUS) for large files, plain Supabase upload for small
// ones, and a graceful fallback to the plain upload whenever the resumable path cannot be used
// (endpoint not reachable / CORS, resumable not enabled, token missing, repeated chunk failures).
// Policy errors surface from the plain upload, which gives the clearest message.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resumableEndpoint, shouldUseResumable, uploadResumable } from "./resumable-upload";

export interface UploadWithResumeOptions {
  bucket: string;
  path: string;
  file: File;
  contentType?: string | null;
  /** 0..1, only reported for resumable uploads. */
  onProgress?: (fraction: number) => void;
}

export interface UploadWithResumeResult {
  error: string | null;
  mode: "resumable" | "standard";
  /** Set when the resumable path was tried first and the plain upload took over. */
  fellBackBecause?: string;
}

export async function uploadWithResume(supabase: SupabaseClient, opts: UploadWithResumeOptions): Promise<UploadWithResumeResult> {
  let fellBackBecause: string | undefined;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl && shouldUseResumable(opts.file.size, { hasAccessToken: true, hasFetch: typeof fetch === "function" })) {
    let accessToken: string | null = null;
    try {
      accessToken = (await supabase.auth.getSession()).data.session?.access_token ?? null;
    } catch {
      accessToken = null;
    }
    if (accessToken) {
      const result = await uploadResumable({
        file: opts.file,
        bucket: opts.bucket,
        objectName: opts.path,
        endpoint: resumableEndpoint(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_RESUMABLE_URL),
        accessToken,
        apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
        contentType: opts.contentType ?? opts.file.type,
        onProgress: opts.onProgress,
      });
      if (result.ok) return { error: null, mode: "resumable" };
      if (result.aborted) return { error: result.error, mode: "resumable" };
      fellBackBecause = result.error;
    } else {
      fellBackBecause = "no session token";
    }
  }

  const { error } = await supabase.storage
    .from(opts.bucket)
    .upload(opts.path, opts.file, { contentType: opts.contentType ?? (opts.file.type || undefined) });
  return { error: error ? error.message || "Upload failed." : null, mode: "standard", fellBackBecause };
}
