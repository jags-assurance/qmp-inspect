import "dotenv/config";
import { supabase } from "./supabase";
import { renderItpPdf } from "./jobs/renderItpPdf";
import { generateMonthlyReportPack } from "./jobs/generateMonthlyReportPack";
import { renderInspectionReportPdf } from "./jobs/renderInspectionReportPdf";
import type {
  BackgroundJobRow,
  GenerateMonthlyReportPackPayload,
  RenderInspectionReportPdfPayload,
  RenderItpPdfPayload,
} from "./jobs/types";

const POLL_INTERVAL_MS = 3000;

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

async function claimNextPendingJob(): Promise<BackgroundJobRow | null> {
  const { data: candidates, error } = await jobsTable()
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("[worker] Failed to poll background_jobs:", error.message);
    return null;
  }

  const candidate = candidates?.[0];
  if (!candidate) return null;

  // Optimistic claim: only succeeds if the row is still 'pending' (guards against a second worker
  // instance racing this one — there is only one deployed today, but the queue is shared state).
  const { data: claimed, error: claimError } = await jobsTable()
    .update({ status: "processing", attempts: candidate.attempts + 1 })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select();

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
      case "render_inspection_report_pdf": {
        const { resultStoragePath } = await renderInspectionReportPdf(
          job.payload as unknown as RenderInspectionReportPdfPayload
        );
        await markCompleted(job.id, resultStoragePath);
        console.log(`[worker] Job ${job.id} completed -> ${resultStoragePath}`);
        break;
      }
      default:
        throw new Error(`Unknown job_type: ${job.job_type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[worker] Job ${job.id} failed:`, message);
    await markFailed(job.id, message);
  }
}

async function pollOnce(): Promise<void> {
  const job = await claimNextPendingJob();
  if (job) await processJob(job);
}

async function main() {
  const { error } = await supabase.from("organizations").select("id").limit(1);
  if (error) {
    console.error("[worker] Supabase connectivity check failed:", error.message);
    process.exit(1);
  }

  console.log(`[worker] Connected to Supabase. Polling background_jobs every ${POLL_INTERVAL_MS}ms.`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await pollOnce().catch((err) => console.error("[worker] Unexpected error in poll loop:", err));
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
