import "dotenv/config";
import * as Sentry from "@sentry/node";
import { supabase } from "./supabase";
import { renderItpPdf } from "./jobs/renderItpPdf";
import { generateMonthlyReportPack } from "./jobs/generateMonthlyReportPack";
import { generateWeeklyReportPack } from "./jobs/generateWeeklyReportPack";
import { renderInspectionReportPdf } from "./jobs/renderInspectionReportPdf";
import { renderFatReportPdf } from "./jobs/renderFatReportPdf";
import { renderPortfolioSummaryPdf } from "./jobs/renderPortfolioSummaryPdf";
import { renderNcrPdf } from "./jobs/renderNcrPdf";
import { renderIrnPdf } from "./jobs/renderIrnPdf";
import { renderHandoverCertificatePdf } from "./jobs/renderHandoverCertificatePdf";
import { renderDataBookPdf } from "./jobs/renderDataBookPdf";
import { renderNcrCloseoutPdf } from "./jobs/renderNcrCloseoutPdf";
import { closeSharedBrowser } from "./browserPool";
import { jobAbortStorage, type JobAbortContext } from "./jobs/jobAbort";
import { shouldRetry, retryDelayMs, MAX_JOB_ATTEMPTS, jobTimeoutMs, orphanAction, pickClaimable } from "./jobs/retryPolicy";
import { runAutomationSweep } from "./automation";
import { dropBreadcrumb, scrubEvent } from "./observability/scrub";
import { isRpcMissing, parseClaimRpcResult, replicaId, sweepLeaseSeconds, type RpcError } from "./jobs/claim";
import type {
  BackgroundJobRow,
  GenerateMonthlyReportPackPayload,
  GenerateWeeklyReportPackPayload,
  RenderFatReportPdfPayload,
  RenderInspectionReportPdfPayload,
  RenderItpPdfPayload,
  RenderPortfolioSummaryPdfPayload,
  RenderNcrPdfPayload,
  RenderIrnPdfPayload,
  RenderDataBookPdfPayload,
  RenderNcrCloseoutCertificatePayload,
} from "./jobs/types";

// Round-table SRE finding: a worker crash-loop or stall previously failed silently — logQueueHealth
// only logs, nobody is alerted. A true no-op until SENTRY_DSN is actually set (no Sentry account
// exists yet) — see apps/web/sentry.server.config.ts for the same gating pattern on the web side,
// and docs/INCIDENT_RESPONSE.md for the current status.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    // E-08: job errors embed names, emails and document text; send no PII and scrub what remains.
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: dropBreadcrumb,
  });
}

/** console.error plus (when configured) Sentry.captureException — never instead of the console log,
 *  which Railway's own log viewer already depends on. */
function reportError(context: string, error: unknown): void {
  console.error(context, error instanceof Error ? error.message : error);
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
      tags: { context },
    });
  }
}

const POLL_INTERVAL_MS = 3000;

// Each job runs under a wall-clock budget from jobTimeoutMs() (jobs/retryPolicy.ts): 3 minutes for a
// one-page render, much longer for a multi-pass Data Book. A hung/OOM'd Chromium render (or a network
// stall mid-fetch) would otherwise sit in 'processing' forever, silently blocking every other job behind
// it for every tenant, since this worker processes one row at a time.

// Log queue depth / oldest-pending-job age this often (in poll cycles), not every single tick, so
// a stuck queue is visible in Railway logs without spamming them.
const OBSERVABILITY_LOG_EVERY_N_CYCLES = 20; // ~once a minute at POLL_INTERVAL_MS = 3000

// The automation sweep (stuck Hold / overdue NCR / overdue punch item nudges) checks hour-scale
// conditions, not this queue's own second-scale job backlog — running it every poll cycle would be
// 20x more Supabase round trips than useful. ~15 minutes at POLL_INTERVAL_MS = 3000 is frequent
// enough that a real automation_rules threshold_hours (minimum 1) is never meaningfully delayed.
const AUTOMATION_SWEEP_EVERY_N_CYCLES = 300;

// `background_jobs` isn't in `@jags/shared-types` yet (see jobs/types.ts) — this worker is the
// only thing that queries it, so a single narrow `as unknown as` cast here stands in for
// generated types rather than threading `any` through every call site below.
const jobsTable = () => supabase.from("background_jobs" as never) as unknown as {
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

async function claimNextPendingJob(): Promise<BackgroundJobRow | null> {
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

async function markCompleted(jobId: string, resultStoragePath: string): Promise<void> {
  const { error } = await jobsTable()
    .update({ status: "completed", result_storage_path: resultStoragePath, completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "processing")
    .select();

  if (error) console.error("[worker] Failed to mark job completed", jobId, error.message);
}

async function markFailed(jobId: string, errorMessage: string): Promise<void> {
  const { error } = await jobsTable()
    .update({ status: "failed", error_message: errorMessage.slice(0, 2000), completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "processing")
    .select();

  if (error) console.error("[worker] Failed to mark job failed", jobId, error.message);
}

/** Puts a transiently failed job back in the queue (backoff enforced in-process). */
async function markRetry(jobId: string, errorMessage: string, attempts: number): Promise<boolean> {
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

async function processJob(job: BackgroundJobRow): Promise<void> {
  console.log(`[worker] Processing job ${job.id} (${job.job_type}, attempt ${job.attempts})`);
  try {
    switch (job.job_type) {
      case "render_itp_pdf": {
        const { resultStoragePath } = await renderItpPdf(job.payload as unknown as RenderItpPdfPayload);
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "generate_monthly_report_pack": {
        const { resultStoragePath } = await generateMonthlyReportPack(
          job.payload as unknown as GenerateMonthlyReportPackPayload
        );
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "generate_weekly_report_pack": {
        const { resultStoragePath } = await generateWeeklyReportPack(
          job.payload as unknown as GenerateWeeklyReportPackPayload
        );
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_inspection_report_pdf": {
        const { resultStoragePath } = await renderInspectionReportPdf(
          job.payload as unknown as RenderInspectionReportPdfPayload
        );
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_fat_report_pdf": {
        const { resultStoragePath } = await renderFatReportPdf(job.payload as unknown as RenderFatReportPdfPayload);
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_portfolio_summary_pdf": {
        const { resultStoragePath } = await renderPortfolioSummaryPdf(
          job.payload as unknown as RenderPortfolioSummaryPdfPayload
        );
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_ncr_pdf": {
        const { resultStoragePath } = await renderNcrPdf(job.payload as unknown as RenderNcrPdfPayload);
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_irn_pdf": {
        const { resultStoragePath } = await renderIrnPdf(job.payload as unknown as RenderIrnPdfPayload);
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_data_book_pdf": {
        const dbPayload = job.payload as unknown as RenderDataBookPdfPayload;
        const { resultStoragePath } =
          dbPayload.variant === "handover_certificate" ? await renderHandoverCertificatePdf(dbPayload) : await renderDataBookPdf(dbPayload);
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      case "render_ncr_closeout_certificate": {
        const { resultStoragePath } = await renderNcrCloseoutPdf(job.payload as unknown as RenderNcrCloseoutCertificatePayload);
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      default:
        throw new Error(`Unknown job_type: ${job.job_type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError(`[worker] Job ${job.id} (${job.job_type}) failed:`, err);
    if (shouldRetry(job.attempts, err) && (await markRetry(job.id, message, job.attempts))) {
      console.log(`[worker] Job ${job.id} requeued (attempt ${job.attempts} of ${MAX_JOB_ATTEMPTS}).`);
    } else {
      await markFailed(job.id, message);
    }
  }
}

/**
 * Races `processJob` against a hard wall-clock timeout so one hung/OOM'd Chromium render can't
 * block the queue forever. `Promise.race` cannot cancel the losing side, so on a timeout the job's
 * own `processJob`/job-file promise keeps running in the background; its own `try/finally {
 * browser.close() }` (present in every job file under worker/src/jobs/) still runs whenever that
 * settles, so no zombie Chromium process is left behind — this just stops the QUEUE from waiting on
 * it. `markFailed`/`markCompleted` are both conditioned on `.eq("status", "processing")`, so if the
 * job actually finishes after we've already marked it failed here, that later update is a no-op
 * against the already-'failed' row instead of clobbering it.
 */
async function processJobWithTimeout(job: BackgroundJobRow): Promise<void> {
  let timedOut = false;
  const timeoutMs = jobTimeoutMs(job.job_type, job.payload);
  // Checked by renderers / the vault filer before any upload or filing (see jobs/jobAbort.ts), so a
  // job we have already given up on cannot publish a document afterwards.
  const ctx: JobAbortContext = { aborted: false };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      ctx.aborted = true;
      resolve();
    }, timeoutMs);
  });

  await Promise.race([jobAbortStorage.run(ctx, () => processJob(job)), timeout]);
  if (timer) clearTimeout(timer);

  if (timedOut) {
    console.error(`[worker] Job ${job.id} (${job.job_type}) exceeded ${timeoutMs}ms — marking failed.`);
    await markFailed(job.id, `Render timed out after ${Math.round(timeoutMs / 1000)}s.`);
  }
}

/** Queue depth + oldest-pending-job age, logged periodically so a stuck queue is visible in Railway
 *  logs (DIY observability — no metrics platform involved). */
async function logQueueHealth(): Promise<void> {
  const { data, error } = await jobsTable().select("created_at").eq("status", "pending").order("created_at", { ascending: true }).limit(1000);

  if (error) {
    console.error("[worker] Failed to check queue health:", error.message);
    return;
  }

  const pending = data ?? [];
  const oldest = pending[0];
  const oldestAgeSec = oldest ? Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 1000) : 0;
  console.log(`[worker] Queue health: ${pending.length} pending job(s), oldest pending age ${oldestAgeSec}s.`);
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
async function reclaimOrphanedJobs(): Promise<void> {
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
  const stale = (processing ?? []).filter((j) => now - Date.parse(j.started_at ?? j.created_at) > jobTimeoutMs(j.job_type, j.payload));
  if (stale.length === 0) return;

  for (const job of stale) {
    // Requeue while attempts remain: a redeploy must not silently lose an auto-queued certificate or close-out.
    const requeue = orphanAction(job.attempts ?? 0) === "requeue";
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

const REPLICA_ID = replicaId();

/**
 * Lease so a once-per-interval sweep runs on ONE replica at a time (F-04): the automation sweep sends
 * notifications, and N replicas each running it on their own 15-minute cadence would race
 * (alreadyNotifiedRecently is check-then-insert). Fails open — if the lease RPC is not installed yet
 * (single replica, migration pending) or errors, the sweep runs, exactly as before this change.
 */
async function tryAcquireLease(name: string, ttlSeconds: number): Promise<boolean> {
  const { data, error } = await (
    supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: RpcError | null }>
  ).call(supabase, "try_acquire_worker_lease", { p_name: name, p_holder: REPLICA_ID, p_ttl_seconds: ttlSeconds });
  if (error) {
    if (!isRpcMissing(error)) console.warn(`[worker] Lease check for ${name} failed, running anyway:`, error.message);
    return true;
  }
  return data === true;
}

async function pollOnce(cycle: number): Promise<void> {
  if (cycle % OBSERVABILITY_LOG_EVERY_N_CYCLES === 0) {
    await logQueueHealth();
    await reclaimOrphanedJobs();
  }

  if (
    cycle % AUTOMATION_SWEEP_EVERY_N_CYCLES === 0 &&
    (await tryAcquireLease("automation_sweep", sweepLeaseSeconds(AUTOMATION_SWEEP_EVERY_N_CYCLES * POLL_INTERVAL_MS)))
  ) {
    await runAutomationSweep().catch((err) => reportError("[worker] Automation sweep failed:", err));
  }

  const job = await claimNextPendingJob();
  if (job) await processJobWithTimeout(job);
}

async function main() {
  const { error } = await supabase.from("organizations").select("id").limit(1);
  if (error) {
    reportError("[worker] Supabase connectivity check failed:", error);
    process.exit(1);
  }

  // Reclaim on startup too, not just periodically — the whole reason a job gets orphaned is a
  // worker restart, so the moment right after one is exactly when a stale row is most likely to
  // be sitting there from before.
  await reclaimOrphanedJobs();

  console.log(`[worker] Connected to Supabase. Polling background_jobs every ${POLL_INTERVAL_MS}ms.`);

  let cycle = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pollOnce(cycle).catch((err) => reportError("[worker] Unexpected error in poll loop:", err));
    cycle += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Railway sends SIGTERM on redeploy/restart. The shared Puppeteer browser (browserPool.ts) is the
// one long-lived resource this process holds outside the poll loop itself — close it explicitly so
// a redeploy doesn't leave an orphaned Chromium process behind, then exit. Best-effort: a job
// mid-render at shutdown is already covered by reclaimOrphanedJobs() on the next worker startup.
async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] Received ${signal}, shutting down.`);
  await closeSharedBrowser();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main();
