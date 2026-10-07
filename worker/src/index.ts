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
import { renderDataBookPdf } from "./jobs/renderDataBookPdf";
import { renderNcrCloseoutPdf } from "./jobs/renderNcrCloseoutPdf";
import { closeSharedBrowser } from "./browserPool";
import { jobAbortStorage, type JobAbortContext } from "./jobs/jobAbort";
import { shouldRetry, retryDelayMs, isJobClaimable, MAX_JOB_ATTEMPTS } from "./jobs/retryPolicy";
import { runAutomationSweep } from "./automation";
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
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
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

// All 5 job types render a short, single-page-or-few-page PDF via Puppeteer — none of them should
// legitimately take anywhere near this long. A hung/OOM'd Chromium render (or a network stall
// mid-fetch) would otherwise sit in 'processing' forever, silently blocking every other job behind
// it for every tenant, since this worker processes one row at a time.
const JOB_TIMEOUT_MS = 3 * 60 * 1000;

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
  update: (values: Partial<BackgroundJobRow>) => {
    eq: (column: string, value: string) => {
      eq: (
        column: string,
        value: string
      ) => { select: () => Promise<{ data: BackgroundJobRow[] | null; error: { message: string } | null }> };
    };
  };
};

// In-memory backoff for retried jobs (job id -> earliest next claim time). A worker restart simply
// clears it, which only means a retry happens sooner.
const retryNotBefore = new Map<string, number>();

async function claimNextPendingJob(): Promise<BackgroundJobRow | null> {
  const { data: candidates, error } = await jobsTable()
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[worker] Failed to poll background_jobs:", error.message);
    return null;
  }

  const now = Date.now();
  const candidate = candidates?.find((c) => (retryNotBefore.get(c.id) ?? 0) <= now && isJobClaimable(c, now));
  if (!candidate) return null;

  // Optimistic claim: only succeeds if the row is still 'pending' (guards against a second worker
  // instance racing this one — there is only one deployed today, but the queue is shared state).
  // This compare-and-swap is what makes it already safe to run 2+ replicas of this same process
  // (e.g. to parallelize across the per-org rate-limited queue) without any further code change —
  // only one replica's UPDATE ... WHERE status = 'pending' can win per row; the loser gets 0 rows
  // back and simply polls again. Scaling replicas is a Railway dashboard/infra change, not a code
  // change, and is intentionally out of scope here.
  // started_at is the timestamp the reaper measures a stuck job from (created_at is when it was
  // QUEUED, which can be long before it was claimed). If the column does not exist yet, claim without it.
  let { data: claimed, error: claimError } = await jobsTable()
    .update({ status: "processing", attempts: candidate.attempts + 1, started_at: new Date().toISOString() } as Partial<BackgroundJobRow>)
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select();

  if (claimError) {
    console.warn("[worker] Claim with started_at failed, retrying without it:", claimError.message);
    ({ data: claimed, error: claimError } = await jobsTable()
      .update({ status: "processing", attempts: candidate.attempts + 1 })
      .eq("id", candidate.id)
      .eq("status", "pending")
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
  const { error } = await jobsTable()
    .update({ status: "pending", error_message: `Attempt ${attempts} failed, will retry: ${errorMessage.slice(0, 1900)}` })
    .eq("id", jobId)
    .eq("status", "processing")
    .select();
  if (error) {
    console.error("[worker] Failed to requeue job", jobId, error.message);
    return false;
  }
  retryNotBefore.set(jobId, Date.now() + retryDelayMs(attempts));
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
        const { resultStoragePath } = await renderDataBookPdf(job.payload as unknown as RenderDataBookPdfPayload);
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
  // Checked by renderers / the vault filer before any upload or filing (see jobs/jobAbort.ts), so a
  // job we have already given up on cannot publish a document afterwards.
  const ctx: JobAbortContext = { aborted: false };
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      ctx.aborted = true;
      resolve();
    }, JOB_TIMEOUT_MS);
  });

  await Promise.race([jobAbortStorage.run(ctx, () => processJob(job)), timeout]);
  if (timer) clearTimeout(timer);

  if (timedOut) {
    console.error(`[worker] Job ${job.id} (${job.job_type}) exceeded ${JOB_TIMEOUT_MS}ms — marking failed.`);
    await markFailed(job.id, `Render timed out after ${Math.round(JOB_TIMEOUT_MS / 1000)}s.`);
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
 * `processJobWithTimeout`'s JOB_TIMEOUT_MS race only protects against a hung render *within this
 * process* — if the whole worker process is killed (a Railway redeploy, an OOM, a crash) while a
 * job is claimed, the row is left in 'processing' forever: nothing else ever revisits it, so the
 * web app's "latest job for this ITP" lookup (getLatestItpPdf) shows an infinite "Rendering…" with
 * no way to retry. Found live: a render_itp_pdf job orphaned by a redeploy on 2026-09-15 sat in
 * 'processing' for 2+ days, making the Generate PDF button on that ITP look permanently broken.
 * This sweep reclaims any job that's been 'processing' longer than the same JOB_TIMEOUT_MS this
 * worker itself uses to give up on an in-process render — by then a live worker would already have
 * timed it out, so anything still 'processing' past that point can only be orphaned.
 */
async function reclaimOrphanedJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - JOB_TIMEOUT_MS).toISOString();
  type StaleResult = { data: { id: string; job_type: string }[] | null; error: { message: string } | null };
  // Measure from started_at (set on claim); rows without it fall back to created_at. If the column
  // is missing (migration not applied yet) the first query errors and we use created_at alone.
  let { data: stale, error } = (await supabase
    .from("background_jobs" as never)
    .select("id, job_type")
    .eq("status", "processing")
    .or(`started_at.lt.${cutoff},and(started_at.is.null,created_at.lt.${cutoff})`)) as unknown as StaleResult;
  if (error) {
    ({ data: stale, error } = (await supabase
      .from("background_jobs" as never)
      .select("id, job_type")
      .eq("status", "processing")
      .lt("created_at", cutoff)) as unknown as StaleResult);
  }

  if (error) {
    console.error("[worker] Failed to check for orphaned jobs:", error.message);
    return;
  }
  if (!stale || stale.length === 0) return;

  for (const job of stale) {
    const { error: updateError } = (await supabase
      .from("background_jobs" as never)
      .update({
        status: "failed",
        error_message: "Orphaned: the worker was restarted before this job finished rendering. Please retry.",
        completed_at: new Date().toISOString(),
      } as never)
      .eq("id", job.id)
      .eq("status", "processing")) as unknown as { error: { message: string } | null };

    if (updateError) {
      console.error(`[worker] Failed to reclaim orphaned job ${job.id}:`, updateError.message);
    } else {
      console.error(`[worker] Reclaimed orphaned job ${job.id} (${job.job_type}) — stuck in 'processing' since before ${cutoff}.`);
    }
  }
}

async function pollOnce(cycle: number): Promise<void> {
  if (cycle % OBSERVABILITY_LOG_EVERY_N_CYCLES === 0) {
    await logQueueHealth();
    await reclaimOrphanedJobs();
  }

  if (cycle % AUTOMATION_SWEEP_EVERY_N_CYCLES === 0) {
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
