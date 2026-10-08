// Pure decision + message logic for the "a background job failed permanently" admin alert. No I/O here
// so it is unit tested directly; jobFailureAlert.ts does the database work.
import { redactText } from "../observability/scrub";

export interface FailedJobFacts {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  error_message?: string | null;
  failure_notified_at?: string | null;
}

/**
 * Should the admins be told about this job? Only when the job is in the terminal 'failed' state (a job
 * being retried is 'pending', so a transient first/second failure never alerts) and nobody was told
 * about it already. `failure_notified_at` is the exactly-once guard; the database-side claim in
 * jobFailureAlert.ts makes the same rule atomic.
 */
export function shouldAlertOnFailure(job: FailedJobFacts): boolean {
  if (job.status !== "failed") return false;
  if (job.failure_notified_at) return false;
  return true;
}

const MAX_SUMMARY = 240;

/** One-line, PII-scrubbed, length-capped error summary. Never throws. */
export function summariseError(message: string | null | undefined): string {
  const text = redactText(String(message ?? "").replace(/\s+/g, " ").trim());
  if (!text) return "No error message recorded.";
  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text;
}

const JOB_LABELS: Record<string, string> = {
  render_itp_pdf: "ITP PDF",
  generate_monthly_report_pack: "Monthly report pack",
  generate_weekly_report_pack: "Weekly report pack",
  render_inspection_report_pdf: "Inspection report PDF",
  render_fat_report_pdf: "FAT report PDF",
  render_portfolio_summary_pdf: "Portfolio summary PDF",
  render_ncr_pdf: "NCR PDF",
  render_irn_pdf: "IRN PDF",
  render_data_book_pdf: "Data Book PDF",
  render_ncr_closeout_certificate: "NCR close-out certificate",
};

export function jobLabel(jobType: string): string {
  return JOB_LABELS[jobType] ?? redactText(jobType).slice(0, 60);
}

/** Same-site notification link (the notifications table only accepts a leading single "/"). Carries the job id, which also serves as the dedupe key when failure_notified_at is not migrated yet. */
export function failureAlertLink(jobId: string): string {
  return `/inspect/reports-documents?failed_job=${encodeURIComponent(jobId)}`;
}

export function buildFailureAlert(
  job: FailedJobFacts,
  projectLabel: string | null
): { title: string; body: string; link: string } {
  const label = jobLabel(job.job_type);
  const where = projectLabel ? ` for ${redactText(projectLabel).slice(0, 120)}` : "";
  return {
    title: `Background job failed: ${label}`,
    body:
      `${label}${where} failed permanently after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"}. ` +
      `Job ${job.id}. Error: ${summariseError(job.error_message)}`,
    link: failureAlertLink(job.id),
  };
}

/** Organisation / project a job belongs to, when its payload says so directly. */
export function scopeFromPayload(payload: Record<string, unknown> | null | undefined): { organizationId: string | null; projectId: string | null } {
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return { organizationId: str(payload?.organization_id), projectId: str(payload?.project_id) };
}

/** True when a Postgres/PostgREST error means the failure_notified_at column does not exist yet (migration not applied). */
export function isMissingFailureColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /failure_notified_at/i.test(error.message ?? "");
}
