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
import { shouldRetry, MAX_JOB_ATTEMPTS, jobTimeoutMs } from "./jobs/retryPolicy";
import { jobsTable, claimNextPendingJob, markCompleted, markFailed, markRetry, reclaimOrphanedJobs } from "./jobs/queue";
import { alertPermanentJobFailure, sweepUnnotifiedFailedJobs } from "./jobs/jobFailureAlert";
import { runAutomationSweep } from "./automation";
import { dropBreadcrumb, scrubEvent } from "./observability/scrub";
import { isRpcMissing, replicaId, sweepLeaseSeconds, type RpcError } from "./jobs/claim";
import { sweepTransmittalOutbox } from "./emailOutbox";
import { runRetentionSweep } from "./retention";
import { runOrphanPhotoSweep } from "./orphanPhotos";
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

// Transmittal emails the web app could not finish sending (S7-26) are retried about once a minute.
const EMAIL_OUTBOX_EVERY_N_CYCLES = 20;

// Retention flagging (S6-18) is a daily job; it enforces its own 24 hour spacing, so this only decides
// how often the gate is checked (~hourly) and lets it run shortly after a worker (re)start.
const RETENTION_CHECK_EVERY_N_CYCLES = 1200;

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
    } else if (await markFailed(job.id, message)) {
      // Final failure: tell the organisation's admins once. Never throws.
      await alertPermanentJobFailure({ ...job, status: "failed", error_message: message });
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
    const timeoutMessage = `Render timed out after ${Math.round(timeoutMs / 1000)}s.`;
    if (await markFailed(job.id, timeoutMessage)) {
      await alertPermanentJobFailure({ ...job, status: "failed", error_message: timeoutMessage });
    }
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
    // Catch-up for failures nobody was told about (orphans that ran out of attempts, a crash before the alert).
    await sweepUnnotifiedFailedJobs();
  }

  if (
    cycle % AUTOMATION_SWEEP_EVERY_N_CYCLES === 0 &&
    (await tryAcquireLease("automation_sweep", sweepLeaseSeconds(AUTOMATION_SWEEP_EVERY_N_CYCLES * POLL_INTERVAL_MS)))
  ) {
    await runAutomationSweep().catch((err) => reportError("[worker] Automation sweep failed:", err));
  }

  if (cycle % RETENTION_CHECK_EVERY_N_CYCLES === 0) {
    await runRetentionSweep().catch((err) => reportError("[worker] Retention sweep failed:", err));
    // Same hourly gate; orphan photo flagging enforces its own once-a-day spacing.
    await runOrphanPhotoSweep().catch((err) => reportError("[worker] Orphan photo sweep failed:", err));
  }

  if (cycle % EMAIL_OUTBOX_EVERY_N_CYCLES === 0) {
    await sweepTransmittalOutbox().catch((err) => reportError("[worker] Transmittal email sweep failed:", err));
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
