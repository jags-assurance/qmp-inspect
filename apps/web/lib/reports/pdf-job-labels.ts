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
      return `PDF generation failed. Please try again${detail ? ` — ${detail}` : ""}`;
    }
  }
}
