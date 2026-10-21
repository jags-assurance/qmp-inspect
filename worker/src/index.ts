import { FAST_POLL_MS, SLOW_POLL_MS, makeDueGate, nextPollDelayMs } from "./pollBackoff";
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
import { renderAuditTrailPdf } from "./jobs/renderAuditTrailPdf";
import { closeSharedBrowser } from "./browserPool";
import { jobAbortStorage, type JobAbortContext } from "./jobs/jobAbort";
import { shouldRetry, MAX_JOB_ATTEMPTS, jobTimeoutMs } from "./jobs/retryPolicy";
import { jobsTable, claimNextPendingJob, markCompleted, markFailed, markRetry, reclaimOrphanedJobs, touchStartedAt } from "./jobs/queue";
import {
  admit, canClaim, jobClass, markFinished, markParked, markStarted, newSchedulerState, nextParked, parseConcurrency, type JobClass,
} from "./jobs/jobConcurrency";
import { alertPermanentJobFailure, sweepUnnotifiedFailedJobs } from "./jobs/jobFailureAlert";
import { runAutomationSweep } from "./automation";
import { runSignoffAutomationSweep } from "./signoffSweepClient";
import { dropBreadcrumb, scrubEvent } from "./observability/scrub";
import { isRpcMissing, replicaId, sweepLeaseSeconds, type RpcError } from "./jobs/claim";
import { sweepNotificationOutbox, sweepTransmittalOutbox } from "./emailOutbox";
import { runRetentionSweep } from "./retention";
import { runNotificationRetentionSweep } from "./notificationRetention";
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
  RenderAuditTrailPdfPayload,
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

const POLL_INTERVAL_MS = FAST_POLL_MS;

// Each job runs under a wall-clock budget from jobTimeoutMs() (jobs/retryPolicy.ts): 3 minutes for a
// one-page render, much longer for a multi-pass Data Book. A hung/OOM'd Chromium render (or a network
// stall mid-fetch) would otherwise sit in 'processing' forever, silently blocking every other job behind
// it for every tenant, since this worker processes one row at a time.

// Log queue depth / oldest-pending-job age this often (in poll cycles), not every single tick, so
// a stuck queue is visible in Railway logs without spamming them.
const OBSERVABILITY_EVERY_MS = 60_000;

// The automation sweep (stuck Hold / overdue NCR / overdue punch item nudges) checks hour-scale
// conditions, not this queue's own second-scale job backlog — running it every poll cycle would be
// 20x more Supabase round trips than useful. ~15 minutes at POLL_INTERVAL_MS = 3000 is frequent
// enough that a real automation_rules threshold_hours (minimum 1) is never meaningfully delayed.
const AUTOMATION_SWEEP_EVERY_MS = 15 * 60_000;

// Transmittal emails the web app could not finish sending (S7-26) are retried about once a minute.
const EMAIL_OUTBOX_EVERY_MS = 60_000;

// Retention flagging (S6-18) is a daily job; it enforces its own 24 hour spacing, so this only decides
// how often the gate is checked (~hourly) and lets it run shortly after a worker (re)start.
const RETENTION_CHECK_EVERY_MS = 60 * 60_000;

const due = makeDueGate();

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
      case "render_audit_trail_pdf": {
        const { resultStoragePath } = await renderAuditTrailPdf(job.payload as unknown as RenderAuditTrailPdfPayload);
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

/** All periodic sweeps. Runs on its own timer, independent of job processing, so reminders, outbox
 *  email and alerts keep flowing while a long Data Book renders. Each sweep is wall-clock gated and
 *  lease-protected; an overlap guard stops a slow sweep from stacking on itself. */
let sweeping = false;
async function runSweeps(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    if (due("observability", OBSERVABILITY_EVERY_MS)) {
      await logQueueHealth();
      await reclaimOrphanedJobs(inFlightIds());
      // Catch-up for failures nobody was told about (orphans that ran out of attempts, a crash before the alert).
      await sweepUnnotifiedFailedJobs();
    }

    if (
      due("automation", AUTOMATION_SWEEP_EVERY_MS) &&
      (await tryAcquireLease("automation_sweep", sweepLeaseSeconds(AUTOMATION_SWEEP_EVERY_MS)))
    ) {
      await runAutomationSweep().catch((err) => reportError("[worker] Automation sweep failed:", err));
      // Time-based sign-off automation (notice period ran out with no response): asks the web app to run its
      // sweep. A no-op until CRON_SECRET and the app URL are set, and for organisations that left it switched off.
      await runSignoffAutomationSweep().catch((err) => reportError("[worker] Sign-off automation sweep failed:", err));
    }

    if (due("retention", RETENTION_CHECK_EVERY_MS)) {
      await runRetentionSweep().catch((err) => reportError("[worker] Retention sweep failed:", err));
      // Same hourly gate; orphan photo flagging enforces its own once-a-day spacing.
      await runOrphanPhotoSweep().catch((err) => reportError("[worker] Orphan photo sweep failed:", err));
      if (await tryAcquireLease("notification_retention", sweepLeaseSeconds(RETENTION_CHECK_EVERY_MS))) {
        await runNotificationRetentionSweep().catch((err) => reportError("[worker] Notification retention sweep failed:", err));
      }
    }

    if (due("email_outbox", EMAIL_OUTBOX_EVERY_MS)) {
      await sweepTransmittalOutbox().catch((err) => reportError("[worker] Transmittal email sweep failed:", err));
      await sweepNotificationOutbox().catch((err) => reportError("[worker] Notification email sweep failed:", err));
    }

    // Keep parked jobs (claimed, waiting for the heavy slot) from looking orphaned to another replica.
    await touchStartedAt(sched.parked.map((p) => p.id));
  } catch (err) {
    reportError("[worker] Sweep error:", err);
  } finally {
    sweeping = false;
  }
}

const CONCURRENCY = parseConcurrency(process.env.WORKER_CONCURRENCY);
const SWEEP_TICK_MS = 15_000;
/** Longest a graceful shutdown waits for in-flight jobs before exiting. */
const SHUTDOWN_GRACE_MS = 25_000;
const sched = newSchedulerState(CONCURRENCY);
const inflight = new Set<Promise<void>>();
let shuttingDown = false;
let wake: (() => void) | null = null;

function inFlightIds(): Set<string> {
  return new Set([...sched.running.keys(), ...sched.parked.map((p) => p.id)]);
}

function startJob(job: BackgroundJobRow, cls: JobClass): void {
  markStarted(sched, job.id, cls);
  const p = (async () => {
    try {
      await processJobWithTimeout(job);
    } catch (err) {
      reportError(`[worker] Job ${job.id} crashed outside its handler:`, err);
    } finally {
      markFinished(sched, job.id);
      drainParked();
      wake?.();
    }
  })();
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

const parkedJobs = new Map<string, BackgroundJobRow>();
function drainParked(): void {
  if (shuttingDown) return;
  for (;;) {
    const next = nextParked(sched);
    if (!next) return;
    const job = parkedJobs.get(next.id);
    parkedJobs.delete(next.id);
    if (!job) {
      sched.parked = sched.parked.filter((p) => p.id !== next.id);
      continue;
    }
    // Fresh orphan clock: the job has been waiting since it was claimed.
    void touchStartedAt([job.id]);
    startJob(job, next.cls);
  }
}

/** One claim attempt. Returns true when it claimed a job (started or parked). */
async function claimOnce(): Promise<boolean> {
  if (!canClaim(sched)) return false;
  const job = await claimNextPendingJob();
  if (!job) return false;
  const cls = jobClass(job.job_type, job.payload);
  if (admit(sched, job.id, cls) === "start") {
    startJob(job, cls);
  } else {
    console.log(`[worker] Job ${job.id} (${job.job_type}) parked until the heavy-job slot is free.`);
    markParked(sched, job.id, cls);
    parkedJobs.set(job.id, job);
  }
  return true;
}

async function main() {
  const { error } = await supabase.from("organizations").select("id").limit(1);
  if (error) {
    reportError("[worker] Supabase connectivity check failed:", error);
    process.exit(1);
  }

  // Reclaim on startup too: the whole reason a job gets orphaned is a worker restart.
  await reclaimOrphanedJobs();

  console.log(
    `[worker] Connected to Supabase. Concurrency ${CONCURRENCY} (max one heavy job). Polling every ${POLL_INTERVAL_MS}ms, backing off to ${SLOW_POLL_MS}ms when idle; sweeps tick every ${SWEEP_TICK_MS}ms.`
  );

  // Sweeps are independent of the job loop.
  void runSweeps();
  setInterval(() => void runSweeps(), SWEEP_TICK_MS).unref?.();

  let idlePolls = 0;
  while (!shuttingDown) {
    const claimed = await claimOnce().catch((err) => {
      reportError("[worker] Unexpected error in poll loop:", err);
      return false;
    });
    if (claimed) {
      idlePolls = 0;
      continue; // try to fill the next free slot straight away
    }
    // At capacity there is nothing to poll for; sleep until a job finishes (or a short tick).
    const full = !canClaim(sched);
    idlePolls = full ? idlePolls : idlePolls + 1;
    const delay = full ? 1000 : nextPollDelayMs(idlePolls);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
    wake = null;
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
