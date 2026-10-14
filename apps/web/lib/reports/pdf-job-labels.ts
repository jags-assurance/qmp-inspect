export const MAX_PDF_JOB_ATTEMPTS = 3;

export interface PdfJobLabelInput {
  status: "pending" | "processing" | "completed" | "failed";
  attempts?: number | null;
  errorMessage?: string | null;
}

/**
 * Attempt number of a requeued job. Uses the job row's `attempts` when selected; otherwise falls back
 * to the worker's requeue message ("Attempt n failed, will retry: ..."), which it writes on every requeue.
 */
export function retryAttempt(job: PdfJobLabelInput): number | null {
  if (job.status !== "pending") return null;
  if (typeof job.attempts === "number" && job.attempts > 0) return job.attempts;
  const m = /^Attempt (\d+) failed, will retry/.exec(job.errorMessage ?? "");
  return m ? Number.parseInt(m[1], 10) : null;
}

/** Label for the in-progress button/line: "Retrying (attempt n of 3)" for a requeued job, else "Rendering…". */
export function renderingLabel(job: PdfJobLabelInput | null | undefined): string {
  const attempt = job ? retryAttempt(job) : null;
  if (attempt === null) return "Rendering…";
  return `Retrying (attempt ${Math.min(attempt + 1, MAX_PDF_JOB_ATTEMPTS)} of ${MAX_PDF_JOB_ATTEMPTS})…`;
}

/** Label for the Generate/Regenerate button: Generating… while a job is queued/processing, "Failed — Regenerate" after a failure. */
export function generateButtonLabel(args: { submitting: boolean; polling: boolean; job: PdfJobLabelInput | null | undefined }): string {
  if (args.submitting) return "Queuing…";
  if (args.polling || args.job?.status === "pending" || args.job?.status === "processing") return "Generating…";
  if (args.job?.status === "failed") return "Failed — Regenerate";
  return args.job ? "Regenerate PDF" : "Generate PDF";
}

/** Status line for a non-completed, non-polling job. */
export function jobStatusText(job: PdfJobLabelInput): string {
  switch (job.status) {
    case "pending": {
      const attempt = retryAttempt(job);
      return attempt === null ? "Queued…" : renderingLabel(job);
    }
    case "processing":
      return "Rendering…";
    case "completed":
      return "Ready";
    case "failed": {
      const detail = (job.errorMessage ?? "").replace(/^Attempt \d+ failed, will retry:\s*/, "").trim();
      // Raw internal errors (SQL, storage paths, stack text) must not reach users: only short plain messages pass.
      const safe = detail && detail.length <= 140 && !/[\\/]|postgres|supabase|error:|\bat\s.+:\d+/i.test(detail) ? detail : "";
      return `PDF generation failed. Please try again${safe ? ` — ${safe}` : ""}`;
    }
  }
}

/** Slack for writes that land right around the moment a render is queued (e.g. a trigger touching updated_at). */
export const PDF_STALE_TOLERANCE_MS = 5_000;

/**
 * S6-14: whether a completed PDF predates the latest change to the record it describes. `createdAt`
 * is when the render job was queued; `changedAt` is the record's last modification (NCR updated_at,
 * inspection sign-off time for an IRN). Unknown or unparseable times are never reported as stale.
 */
export function isPdfStale(createdAt: string | null | undefined, changedAt: string | null | undefined): boolean {
  if (!createdAt || !changedAt) return false;
  const created = Date.parse(createdAt);
  const changed = Date.parse(changedAt);
  if (!Number.isFinite(created) || !Number.isFinite(changed)) return false;
  return changed - created > PDF_STALE_TOLERANCE_MS;
}
