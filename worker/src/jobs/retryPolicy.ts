import { JobAbortedError, PermanentJobError } from "./jobAbort";

export const MAX_JOB_ATTEMPTS = 3;

/** Exponential backoff after the Nth failed attempt: 30s, 2m, 8m, ... capped at 15m. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * Math.pow(4, Math.max(0, attempts - 1)), 15 * 60_000);
}

/**
 * Durable backoff eligibility without a new column: a requeued job (pending, attempts > 0) had its
 * updated_at bumped by the background_jobs_set_updated_at trigger when it was requeued, so it is
 * claimable once updated_at + retryDelayMs(attempts) has passed. Fresh jobs are always eligible.
 */
export function isJobClaimable(job: { attempts: number; updated_at?: string | null }, now: number): boolean {
  if (!job.attempts || job.attempts <= 0) return true;
  const updated = job.updated_at ? Date.parse(job.updated_at) : NaN;
  if (!Number.isFinite(updated)) return true;
  return updated + retryDelayMs(job.attempts) <= now;
}

/** Retry transient failures only, up to MAX_JOB_ATTEMPTS total attempts. */
export function shouldRetry(attempts: number, error: unknown): boolean {
  if (error instanceof PermanentJobError || error instanceof JobAbortedError) return false;
  return attempts < MAX_JOB_ATTEMPTS;
}
