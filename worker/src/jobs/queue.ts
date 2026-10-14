// Job-queue primitives (claim, complete, fail, requeue, orphan reclaim), moved verbatim out of index.ts so
// they can be unit-tested against a mocked Supabase client. index.ts is the poll loop and has process-level
// side effects (it starts polling on import), which made these untestable in place. Behaviour is unchanged.
import { supabase } from "../supabase";
import { retryDelayMs, pickClaimable } from "./retryPolicy";
import { orphanDecision } from "./orphanPolicy";
import { isRpcMissing, parseClaimRpcResult, type RpcError } from "./claim";
import type { BackgroundJobRow } from "./types";

// `background_jobs` isn't in `@jags/shared-types` yet (see jobs/types.ts) — this worker is the
// only thing that queries it, so a single narrow `as unknown as` cast here stands in for
// generated types rather than threading `any` through every call site below.
export const jobsTable = () => supabase.from("background_jobs" as never) as unknown as {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, opts: { ascending: boolean }) => {
        limit: (n: number) => Promise<{ data: BackgroundJobRow[] | null; error: { message: string } | null }>;
      };
    };
  };
  update: (values: Partial<BackgroundJobRow>) => JobsUpdateBuilder;
};
interface JobsUpdateBuilder {
  eq: (column: string, value: string | number) => JobsUpdateBuilder;
  select: () => Promise<{ data: BackgroundJobRow[] | null; error: { message: string } | null }>;
}

// In-memory backoff for retried jobs (job id -> earliest next claim time). A worker restart simply
// clears it, which only means a retry happens sooner.
const retryNotBefore = new Map<string, number>();

// F-04: false once the database says claim_next_background_job() does not exist (migration
// 20261111000103 not applied yet); the worker then uses the compare-and-swap path below for the
// rest of its life, so deploy order of worker vs migration does not matter.
let claimRpcAvailable = true;

/**
 * Preferred claim: ONE atomic statement in the database (UPDATE ... WHERE id = (SELECT ... FOR UPDATE
 * SKIP LOCKED LIMIT 1) RETURNING *). Concurrent replicas each get a different job (or none), attempts is
 * incremented in SQL, and retry backoff is applied there too. Returns { handled: false } when the RPC is
 * unavailable so the caller falls back.
 */
async function claimViaRpc(): Promise<{ handled: boolean; job: BackgroundJobRow | null }> {
  const { data, error } = await (
    supabase.rpc as unknown as (fn: string) => Promise<{ data: unknown; error: RpcError | null }>
  ).call(supabase, "claim_next_background_job");
  if (error) {
    if (isRpcMissing(error)) {
      claimRpcAvailable = false;
      console.warn("[worker] claim_next_background_job() is not installed; using the compare-and-swap claim. Apply migration 20261111000103.");
      return { handled: false, job: null };
    }
    console.error("[worker] Failed to claim a job:", error.message);
    return { handled: true, job: null };
  }
  return { handled: true, job: parseClaimRpcResult<BackgroundJobRow>(data) };
}

export async function claimNextPendingJob(): Promise<BackgroundJobRow | null> {
  if (claimRpcAvailable) {
    const viaRpc = await claimViaRpc();
    if (viaRpc.handled) return viaRpc.job;
  }
  return claimNextPendingJobCompareAndSwap();
}

/**
 * Fallback claim (used only until the claim RPC is installed). Safe against a second replica winning
 * the same row because the UPDATE is conditioned on status = 'pending' AND the attempts value that was
 * read, so a job another replica claimed, failed and requeued in between (status back to 'pending' but
 * attempts changed) is not claimed from stale data. Its weaknesses (every replica picks the same oldest
 * job; backoff partly in-memory) are what claimNextPendingJob's RPC path removes.
 */
async function claimNextPendingJobCompareAndSwap(): Promise<BackgroundJobRow | null> {
  const { data: candidates, error } = await jobsTable()
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(60);

  if (error) {
    console.error("[worker] Failed to poll background_jobs:", error.message);
    return null;
  }

  const now = Date.now();
  // Wide window + never-attempted jobs first, so a few retries waiting out their backoff cannot starve newer jobs.
  const candidate = pickClaimable(candidates ?? [], now, (c) => (retryNotBefore.get(c.id) ?? 0) > now);
  if (!candidate) return null;

  // started_at is the timestamp the reaper measures a stuck job from (created_at is when it was
  // QUEUED, which can be long before it was claimed). If the column does not exist yet, claim without it.
  let { data: claimed, error: claimError } = await jobsTable()
    .update({ status: "processing", attempts: candidate.attempts + 1, started_at: new Date().toISOString() } as Partial<BackgroundJobRow>)
    .eq("id", candidate.id)
    .eq("status", "pending")
    .eq("attempts", candidate.attempts)
    .select();

  if (claimError) {
    console.warn("[worker] Claim with started_at failed, retrying without it:", claimError.message);
    ({ data: claimed, error: claimError } = await jobsTable()
      .update({ status: "processing", attempts: candidate.attempts + 1 })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .eq("attempts", candidate.attempts)
      .select());
  }

  if (claimError) {
    console.error("[worker] Failed to claim job", candidate.id, claimError.message);
    return null;
  }

  return claimed?.[0] ?? null;
}

export async function markCompleted(jobId: string, resultStoragePath: string): Promise<void> {
  const { error } = await jobsTable()
    .update({ status: "completed", result_storage_path: resultStoragePath, completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "processing")
    .select();

  if (error) console.error("[worker] Failed to mark job completed", jobId, error.message);
}

/** Returns true only when THIS call moved the job from 'processing' to 'failed' (so the caller may alert admins once). */
export async function markFailed(jobId: string, errorMessage: string): Promise<boolean> {
  const { data, error } = await jobsTable()
    .update({ status: "failed", error_message: errorMessage.slice(0, 2000), completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "processing")
    .select();

  if (error) {
    console.error("[worker] Failed to mark job failed", jobId, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/** Puts a transiently failed job back in the queue (backoff enforced in-process). */
export async function markRetry(jobId: string, errorMessage: string, attempts: number): Promise<boolean> {
  const notBeforeMs = Date.now() + retryDelayMs(attempts);
  const errorText = `Attempt ${attempts} failed, will retry: ${errorMessage.slice(0, 1900)}`;
  // Persist the backoff (S6-12) so a restart or another replica honours it. If the column does not
  // exist yet (migration 20261108000103 not applied) requeue without it: the in-memory map plus the
  // updated_at rule in isJobClaimable() still enforce the delay.
  let { error } = await jobsTable()
    .update({ status: "pending", error_message: errorText, retry_not_before: new Date(notBeforeMs).toISOString() } as Partial<BackgroundJobRow>)
    .eq("id", jobId)
    .eq("status", "processing")
    .select();
  if (error) {
    console.warn("[worker] Requeue with retry_not_before failed, retrying without it:", error.message);
    ({ error } = await jobsTable()
      .update({ status: "pending", error_message: errorText })
      .eq("id", jobId)
      .eq("status", "processing")
      .select());
  }
  if (error) {
    console.error("[worker] Failed to requeue job", jobId, error.message);
    return false;
  }
  retryNotBefore.set(jobId, notBeforeMs);
  return true;
}

/**
 * `processJobWithTimeout`'s per-type timeout race only protects against a hung render *within this
 * process* — if the whole worker process is killed (a Railway redeploy, an OOM, a crash) while a
 * job is claimed, the row is left in 'processing' forever: nothing else ever revisits it, so the
 * web app's "latest job for this ITP" lookup (getLatestItpPdf) shows an infinite "Rendering…" with
 * no way to retry. Found live: a render_itp_pdf job orphaned by a redeploy on 2026-09-15 sat in
 * 'processing' for 2+ days, making the Generate PDF button on that ITP look permanently broken.
 * This sweep reclaims any job that's been 'processing' longer than that job type's timeout this
 * worker itself uses to give up on an in-process render — by then a live worker would already have
 * timed it out, so anything still 'processing' past that point can only be orphaned.
 */
export async function reclaimOrphanedJobs(inFlightIds: ReadonlySet<string> = new Set()): Promise<void> {
  // A job is orphaned once it has been 'processing' longer than ITS OWN type's timeout (a live worker would
  // already have timed it out by then). Measure from started_at (set on claim); rows without it fall back to
  // created_at. If the column is missing (migration not applied yet) the first query errors and we use created_at.
  type Stale = { id: string; job_type: string; payload: Record<string, unknown> | null; attempts: number; started_at?: string | null; created_at: string };
  type StaleResult = { data: Stale[] | null; error: { message: string } | null };
  const oldest = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  let { data: processing, error } = (await supabase
    .from("background_jobs" as never)
    .select("id, job_type, payload, attempts, started_at, created_at")
    .eq("status", "processing")
    .or(`started_at.lt.${oldest},and(started_at.is.null,created_at.lt.${oldest})`)) as unknown as StaleResult;
  if (error) {
    ({ data: processing, error } = (await supabase
      .from("background_jobs" as never)
      .select("id, job_type, payload, attempts, created_at")
      .eq("status", "processing")
      .lt("created_at", oldest)) as unknown as StaleResult);
  }

  if (error) {
    console.error("[worker] Failed to check for orphaned jobs:", error.message);
    return;
  }
  const now = Date.now();
  // Jobs this very process is still running (or has parked) are never orphans, whatever started_at says.
  const stale = (processing ?? []).filter((j) => !inFlightIds.has(j.id) && orphanDecision(j, now) !== "keep");
  if (stale.length === 0) return;

  for (const job of stale) {
    // Requeue while attempts remain (capped): a redeploy must not silently lose an auto-queued certificate or close-out.
    const requeue = orphanDecision(job, now) === "requeue";
    const { error: updateError } = (await supabase
      .from("background_jobs" as never)
      .update(
        (requeue
          ? { status: "pending", error_message: "Attempt interrupted by a worker restart; requeued automatically." }
          : {
              status: "failed",
              error_message: "Orphaned: the worker was restarted before this job finished rendering, and it ran out of attempts. Please retry.",
              completed_at: new Date().toISOString(),
            }) as never
      )
      .eq("id", job.id)
      .eq("status", "processing")) as unknown as { error: { message: string } | null };

    if (updateError) {
      console.error(`[worker] Failed to reclaim orphaned job ${job.id}:`, updateError.message);
    } else {
      console.error(`[worker] ${requeue ? "Requeued" : "Failed"} orphaned job ${job.id} (${job.job_type}) — stuck in 'processing' since ${job.started_at ?? job.created_at}.`);
    }
  }
}

/** Resets the orphan clock of jobs this process holds (parked behind the heavy slot, or just starting), so another replica's reaper leaves them alone. Best-effort. */
export async function touchStartedAt(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { error } = (await supabase
    .from("background_jobs" as never)
    .update({ started_at: new Date().toISOString() } as never)
    .in("id", jobIds)
    .eq("status", "processing")) as unknown as { error: { message: string } | null };
  if (error) console.warn("[worker] Could not refresh started_at heartbeat:", error.message);
}

/** Test hook: restores the module-level queue state (in-memory backoff map, RPC availability flag). */
export function resetQueueStateForTests(): void {
  retryNotBefore.clear();
  claimRpcAvailable = true;
}

/** Test hook: the earliest next-claim time recorded for a requeued job, if any. */
export function retryNotBeforeFor(jobId: string): number | undefined {
  return retryNotBefore.get(jobId);
}
