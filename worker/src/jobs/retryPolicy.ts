import { JobAbortedError, PermanentJobError } from "./jobAbort";

export const MAX_JOB_ATTEMPTS = 3;

/** Exponential backoff after the Nth failed attempt: 30s, 2m, 8m, ... capped at 15m. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * Math.pow(4, Math.max(0, attempts - 1)), 15 * 60_000);
}

/**
 * Durable backoff eligibility (S6-12). When a retried job carries `retry_not_before` (column added by
 * 20261108000103, written by the worker when it requeues a failed attempt) that persisted timestamp is
 * authoritative, so a worker restart or a second replica honours the same backoff. Before that migration
 * is applied (or for rows requeued without it, e.g. orphan reclaim) it falls back to the old rule: a
 * requeued job (pending, attempts > 0) had its updated_at bumped by the background_jobs_set_updated_at
 * trigger, so it is claimable once updated_at + retryDelayMs(attempts) has passed. Fresh jobs are
 * always eligible.
 */
export function isJobClaimable(
  job: { attempts: number; updated_at?: string | null; retry_not_before?: string | null },
  now: number
): boolean {
  if (!job.attempts || job.attempts <= 0) return true;
  if (job.retry_not_before) {
    const notBefore = Date.parse(job.retry_not_before);
    if (Number.isFinite(notBefore)) return notBefore <= now;
  }
  const updated = job.updated_at ? Date.parse(job.updated_at) : NaN;
  if (!Number.isFinite(updated)) return true;
  return updated + retryDelayMs(job.attempts) <= now;
}

/** Retry transient failures only, up to MAX_JOB_ATTEMPTS total attempts. */
export function shouldRetry(attempts: number, error: unknown): boolean {
  if (error instanceof PermanentJobError || error instanceof JobAbortedError) return false;
  return attempts < MAX_JOB_ATTEMPTS;
}

/** Default wall-clock budget of a job (short single-document renders). */
export const DEFAULT_JOB_TIMEOUT_MS = 3 * 60 * 1000;
/** A multi-pass Data Book render (numbering passes, up to 2000 pages) legitimately takes far longer. */
export const DATA_BOOK_JOB_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Per-job-type timeout. The Data Book (not its one-page certificate variant) gets the long budget;
 * org report packs aggregate every project so they get a middle one.
 */
export function jobTimeoutMs(jobType: string, payload?: Record<string, unknown> | null): number {
  if (jobType === "render_data_book_pdf") {
    return payload && payload.variant === "handover_certificate" ? DEFAULT_JOB_TIMEOUT_MS : DATA_BOOK_JOB_TIMEOUT_MS;
  }
  if (jobType === "generate_monthly_report_pack" || jobType === "generate_weekly_report_pack" || jobType === "render_portfolio_summary_pdf" || jobType === "render_audit_trail_pdf") {
    return 8 * 60 * 1000;
  }
  return DEFAULT_JOB_TIMEOUT_MS;
}

/**
 * Orphan decision for a job still 'processing' after a worker restart: requeue while attempts remain
 * (a redeploy must not silently lose an auto-queued certificate), otherwise fail it.
 */
export function orphanAction(attempts: number): "requeue" | "fail" {
  return attempts < MAX_JOB_ATTEMPTS ? "requeue" : "fail";
}

/**
 * Claim order: jobs never attempted first (oldest first), then retries whose backoff has elapsed. Reading a
 * wide window and filtering here stops a few jobs sitting in backoff from starving newer ones.
 */
export function pickClaimable<T extends { attempts: number; created_at: string; updated_at?: string | null; retry_not_before?: string | null }>(
  candidates: T[],
  now: number,
  isBlocked: (job: T) => boolean = () => false
): T | null {
  const ok = candidates.filter((c) => !isBlocked(c) && isJobClaimable(c, now));
  ok.sort((a, b) => (a.attempts > 0 ? 1 : 0) - (b.attempts > 0 ? 1 : 0) || a.created_at.localeCompare(b.created_at));
  return ok[0] ?? null;
}
