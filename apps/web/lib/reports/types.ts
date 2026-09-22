// Domain types + table-name handle for the "generate_monthly_report_pack" background_jobs rows
// (R109). background_jobs isn't in the generated Database type's job_type union for this new
// job_type yet — same documented cast pattern as NUMBERING_CONFIGS_TABLE in
// apps/web/lib/numbering/types.ts and ACTIVITY_SIGNOFF_PROGRESS_TABLE in lib/signoff/db-types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow, documented escape hatch
export const BACKGROUND_JOBS_TABLE = "background_jobs" as any;

export const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

export interface MonthlyReportPackPayload {
  organization_id: string;
  year: number;
  month: number;
  requested_by: string;
}

/** Payload for "generate_weekly_report_pack" — the weekly equivalent of MonthlyReportPackPayload
 *  above. `week_start` is an ISO date (YYYY-MM-DD) marking the first day of the 7-day window; see
 *  worker/src/jobs/types.ts's GenerateWeeklyReportPackPayload for why a start date was chosen over
 *  an ISO-week-number + year pair. */
export interface WeeklyReportPackPayload {
  organization_id: string;
  week_start: string;
  requested_by: string;
}

export interface RenderItpPdfPayload {
  itp_id: string;
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

/** Payload for "render_portfolio_summary_pdf" — the one-click portfolio-wide PDF summary (every
 *  organisation, every project). No target id: admin-only, see requestPortfolioSummaryPdfAction. */
export interface RenderPortfolioSummaryPdfPayload {
  requested_by: string;
}

/** Payload for "render_ncr_pdf" — the branded A4 dossier page for a single NCR (finding +
 *  close-out). Same shape as RenderInspectionReportPdfPayload above. */
export interface RenderNcrPdfPayload {
  ncr_id: string;
  requested_by: string;
}

export interface BackgroundJobRow {
  id: string;
  job_type: string;
  payload:
    | MonthlyReportPackPayload
    | WeeklyReportPackPayload
    | RenderItpPdfPayload
    | RenderInspectionReportPdfPayload
    | RenderFatReportPdfPayload
    | RenderPortfolioSummaryPdfPayload
    | RenderNcrPdfPayload;
  status: "pending" | "processing" | "completed" | "failed";
  result_storage_path: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Derives the .xlsx path the worker uploads alongside the PDF, from the PDF's result_storage_path.
 *  See generateMonthlyReportPack.ts in the worker — both files share the same base path. The worker
 *  writes a real Excel workbook here (R107/R109), not a CSV. */
export function xlsxPathFromPdfPath(pdfPath: string): string {
  return pdfPath.replace(/report-pack\.pdf$/, "report-pack.xlsx");
}
