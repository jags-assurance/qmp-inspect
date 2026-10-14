// Pure policy for jobs stranded in 'processing' (a worker restart / crash mid-render).
import { MAX_JOB_ATTEMPTS, jobTimeoutMs } from "./retryPolicy";

export interface ProcessingJob {
  id: string;
  job_type: string;
  payload: Record<string, unknown> | null;
  attempts: number | null;
  started_at?: string | null;
  created_at: string;
}

/** A job is orphaned once it has been 'processing' longer than its own type's timeout (a live worker would have timed it out). */
export function isOrphaned(job: ProcessingJob, now: number): boolean {
  const since = Date.parse(job.started_at ?? job.created_at);
  if (!Number.isFinite(since)) return false;
  return now - since > jobTimeoutMs(job.job_type, job.payload);
}

/** Requeue while attempts remain (capped at MAX_JOB_ATTEMPTS), otherwise fail it for good. */
export function orphanDecision(job: ProcessingJob, now: number): "keep" | "requeue" | "fail" {
  if (!isOrphaned(job, now)) return "keep";
  return (job.attempts ?? 0) < MAX_JOB_ATTEMPTS ? "requeue" : "fail";
}
