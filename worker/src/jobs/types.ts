// `background_jobs` does not exist yet in `@jags/shared-types`'s hand-written `Database` type (it
// is only kept in sync with the web app's migrations — see packages/shared-types/src/database.ts).
// This is a local, worker-only shape for the one table the generated types don't cover; every
// query against it goes through `.returns<T>()` / an explicit cast instead of threading `any`
// through the rest of the file. Delete this once `Database` picks up `background_jobs` for real.
export interface BackgroundJobRow {
  id: string;
  job_type: "render_itp_pdf" | "generate_monthly_report_pack";
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  result_storage_path: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RenderItpPdfPayload {
  itp_id: string;
  requested_by: string;
}

/** Payload for "generate_monthly_report_pack" (R109) — one organisation, one calendar month,
 *  aggregated across ALL of that org's projects. `month` is 1-12. */
export interface GenerateMonthlyReportPackPayload {
  organization_id: string;
  year: number;
  month: number;
  requested_by: string;
}
