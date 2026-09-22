// `background_jobs` does not exist yet in `@jags/shared-types`'s hand-written `Database` type (it
// is only kept in sync with the web app's migrations — see packages/shared-types/src/database.ts).
// This is a local, worker-only shape for the one table the generated types don't cover; every
// query against it goes through `.returns<T>()` / an explicit cast instead of threading `any`
// through the rest of the file. Delete this once `Database` picks up `background_jobs` for real.
export interface BackgroundJobRow {
  id: string;
  job_type:
    | "render_itp_pdf"
    | "generate_monthly_report_pack"
    | "generate_weekly_report_pack"
    | "render_inspection_report_pdf"
    | "render_fat_report_pdf"
    | "render_portfolio_summary_pdf"
    | "render_ncr_pdf"
    | "render_irn_pdf"
    | "render_data_book_pdf"
    | "render_ncr_closeout_certificate";
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

/** Payload for "generate_weekly_report_pack" — one organisation, one 7-day window, aggregated
 *  across ALL of that org's projects. `week_start` is an ISO date (YYYY-MM-DD) marking the first
 *  day of the 7-day window [week_start, week_start + 7 days); chosen over an ISO-week-number +
 *  year pair because generateWeeklyReportPack.ts's date-handling adapts directly from
 *  generateMonthlyReportPack.ts's monthRange()-style helper — a plain start date needs only day
 *  arithmetic instead of also having to derive a calendar date from an (year, week-number) pair. */
export interface GenerateWeeklyReportPackPayload {
  organization_id: string;
  week_start: string;
  requested_by: string;
}

export interface RenderInspectionReportPdfPayload {
  inspection_record_id: string;
  requested_by: string;
}

export interface RenderFatReportPdfPayload {
  assignment_id: string;
  requested_by: string;
}

/** Payload for "render_portfolio_summary_pdf" — the one-click portfolio-wide PDF summary
 *  (every organisation, every project). No target id: the worker queries everything, and only
 *  is_jags_staff() admins can queue this job_type at all (see the RLS with-check on
 *  background_jobs_insert in 20260916150000_portfolio_summary_pdf_job.sql). */
export interface RenderPortfolioSummaryPdfPayload {
  requested_by: string;
}

/** Payload for "render_ncr_pdf" — the branded A4 dossier page for a single NCR (finding +
 *  close-out), matching the client's sample dossier format. Same shape as
 *  RenderInspectionReportPdfPayload: one target row id plus who asked for it. */
export interface RenderNcrPdfPayload {
  ncr_id: string;
  requested_by: string;
}

/** Payload for "render_irn_pdf" — the branded A4 IRN (Inspection Release Note) certificate. Same
 *  shape as RenderNcrPdfPayload: one target row id plus who asked for it. */
export interface RenderIrnPdfPayload {
  irn_id: string;
  requested_by: string;
}

/** Payload for "render_data_book_pdf" — the cover-page-plus-summary Data Book PDF for one project's
 *  data_books row. Same shape as RenderNcrPdfPayload. */
export interface RenderDataBookPdfPayload {
  data_book_id: string;
  requested_by: string;
}

/** Payload for "render_ncr_closeout_certificate" (R83) — the branded A4 close-out certificate for an
 *  NCR that has actually been closed (root cause, corrective action, who closed it and when), distinct
 *  from render_ncr_pdf's finding+close-out dossier which renders at any status. Same shape as
 *  RenderNcrPdfPayload: one target row id plus who asked for it. */
export interface RenderNcrCloseoutCertificatePayload {
  ncr_id: string;
  requested_by: string;
}
