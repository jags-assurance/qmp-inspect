import { JobAbortedError, PermanentJobError } from "./jobAbort";

export const MAX_JOB_ATTEMPTS = 3;

/** Exponential backoff after the Nth failed attempt: 30s, 2m, 8m, ... capped at 15m. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * Math.pow(4, Math.max(0, attempts - 1)), 15 * 60_000);
}

/** Retry transient failures only, up to MAX_JOB_ATTEMPTS total attempts. */
export function shouldRetry(attempts: number, error: unknown): boolean {
  if (error instanceof PermanentJobError || error instanceof JobAbortedError) return false;
  return attempts < MAX_JOB_ATTEMPTS;
}
