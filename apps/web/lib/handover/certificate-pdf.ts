import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { BACKGROUND_JOBS_TABLE } from "@/lib/reports/types";
import { GENERATED_DOCUMENTS_BUCKET } from "@/lib/reports/types";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Signed URL lifetime for downloads of generated PDFs (seconds). Short on purpose: links can be copied outside the RLS boundary. */
const PDF_URL_TTL_SECONDS = 600;

/**
 * The Handover Certificate PDF is rendered by the worker as a variant of the Data Book PDF job
 * ("render_data_book_pdf" with payload.variant = "handover_certificate"), so it reuses that job
 * type's access rules and the generated-documents "databooks/<id>/" read policy.
 *
 * Best-effort by design: the certificate row (not the PDF) is the formal record, so a failure to
 * queue never blocks issuing or acknowledging. Returns false when the job could not be queued so
 * callers can tell the user instead of leaving a stale PDF in place silently.
 *
 * A job that is already PENDING will read the certificate row when it runs, so no second one is
 * needed. A job that is already PROCESSING may have read the row before the latest change (for
 * example the acknowledgement), so a follow-up job is queued behind it.
 */
export async function queueHandoverCertificatePdf(supabase: ServerClient, dataBookId: string, requestedBy: string): Promise<boolean> {
  try {
    const { data: pending } = await supabase
      .from(BACKGROUND_JOBS_TABLE)
      .select("id")
      .eq("job_type", "render_data_book_pdf")
      .eq("payload->>data_book_id", dataBookId)
      .eq("payload->>variant", "handover_certificate")
      .eq("status", "pending")
      .limit(1);
    if (pending && pending.length > 0) return true;
    const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
      job_type: "render_data_book_pdf",
      payload: { data_book_id: dataBookId, requested_by: requestedBy, variant: "handover_certificate" },
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Queues the Data Book PDF for a book that has just been ISSUED. The worker renders it as of the
 * issue date, hashes it and records the path + SHA-256 on the handover certificate, so the book that
 * was certified is frozen at issue time rather than rendered on first click weeks later.
 */
export async function queueIssuedDataBookPdf(supabase: ServerClient, dataBookId: string, requestedBy: string): Promise<boolean> {
  try {
    const { data: inFlight } = await supabase
      .from(BACKGROUND_JOBS_TABLE)
      .select("id")
      .eq("job_type", "render_data_book_pdf")
      .eq("payload->>data_book_id", dataBookId)
      .is("payload->>variant", null)
      .in("status", ["pending", "processing"])
      .limit(1);
    if (inFlight && inFlight.length > 0) return true;
    const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
      job_type: "render_data_book_pdf",
      payload: { data_book_id: dataBookId, requested_by: requestedBy },
    });
    return !error;
  } catch {
    return false;
  }
}

export interface HandoverCertificatePdfInfo {
  /** Signed URL of the latest rendered certificate PDF, if one has completed. */
  url: string | null;
  /** A render is queued or running right now. */
  inFlight: boolean;
  /** When the latest completed render was requested (ISO), to compare against the acknowledgement time. */
  createdAt: string | null;
}

/** Latest certificate PDF state for each data book, in two queries regardless of count. */
export async function getHandoverCertificatePdfInfo(supabase: ServerClient, dataBookIds: string[]): Promise<Map<string, HandoverCertificatePdfInfo>> {
  const result = new Map<string, HandoverCertificatePdfInfo>();
  for (const id of dataBookIds) result.set(id, { url: null, inFlight: false, createdAt: null });
  if (dataBookIds.length === 0) return result;

  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("payload, status, result_storage_path, created_at")
    .eq("job_type", "render_data_book_pdf")
    .eq("payload->>variant", "handover_certificate")
    .in("payload->>data_book_id", dataBookIds)
    .order("created_at", { ascending: false })
    .returns<{ payload: { data_book_id?: string }; status: string; result_storage_path: string | null; created_at: string }[]>();

  const latestDone = new Map<string, { path: string; createdAt: string }>();
  for (const job of jobs ?? []) {
    const id = job.payload?.data_book_id;
    if (!id || !result.has(id)) continue;
    if (job.status === "pending" || job.status === "processing") result.get(id)!.inFlight = true;
    else if (job.status === "completed" && job.result_storage_path && !latestDone.has(id)) latestDone.set(id, { path: job.result_storage_path, createdAt: job.created_at });
  }
  await Promise.all(
    [...latestDone.entries()].map(async ([id, done]) => {
      const { data } = await supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(done.path, PDF_URL_TTL_SECONDS);
      if (data?.signedUrl) {
        result.get(id)!.url = data.signedUrl;
        result.get(id)!.createdAt = done.createdAt;
      }
    })
  );
  return result;
}
