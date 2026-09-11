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

export interface RenderItpPdfPayload {
  itp_id: string;
  requested_by: string;
}

export interface RenderInspectionReportPdfPayload {
  inspection_record_id: string;
  requested_by: string;
}

export interface BackgroundJobRow {
  id: string;
  job_type: string;
  payload: MonthlyReportPackPayload | RenderItpPdfPayload | RenderInspectionReportPdfPayload;
  status: "pending" | "processing" | "completed" | "failed";
  result_storage_path: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/** Derives the CSV path the worker uploads alongside the PDF, from the PDF's result_storage_path.
 *  See generateMonthlyReportPack.ts in the worker — both files share the same base path. */
export function csvPathFromPdfPath(pdfPath: string): string {
  return pdfPath.replace(/report-pack\.pdf$/, "report-pack.csv");
}
