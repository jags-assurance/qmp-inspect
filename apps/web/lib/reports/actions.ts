"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { assertAiAllowed } from "@/lib/ai/gate";
import { aiErrorMessage } from "@/lib/ai/config";
import { sanitizeAiText } from "@/lib/ai/sanitize";
import { logAiUsage, recordAiReviewDecision } from "@/lib/ai/log";
import { findCachedAiResponse, hashAiCacheInput } from "@/lib/ai/cache";
import { geminiProvider, getGeminiModel, PROMPT_VERSIONS, withGeminiUsage, type GeminiTokenUsage } from "@/lib/ai/gemini-provider";
import {
  STANDALONE_ASSIGNMENTS,
  STANDALONE_ASSIGNMENT_MEASUREMENTS,
  STANDALONE_ASSIGNMENT_PUNCH_ITEMS,
} from "@/lib/standalone/types";
import {
  BACKGROUND_JOBS_TABLE,
  GENERATED_DOCUMENTS_BUCKET,
  xlsxPathFromPdfPath,
  type BackgroundJobRow,
  type MonthlyReportPackPayload,
  type WeeklyReportPackPayload,
  type RenderFatReportPdfPayload,
  type RenderInspectionReportPdfPayload,
  type RenderItpPdfPayload,
  type RenderPortfolioSummaryPdfPayload,
  type RenderNcrPdfPayload,
  type RenderIrnPdfPayload,
  type RenderDataBookPdfPayload,
  type RenderNcrCloseoutCertificatePayload,
} from "./types";
import { NCRS_TABLE } from "@/lib/ncrs/types";
import { aggregateReportSummaryData } from "@/lib/reports/report-summary";
import { recordAuditEvent } from "@/lib/audit/log";
import { canRunStandaloneAssignment } from "@/lib/standalone/actions";

export interface GenerateMonthlyReportPackState {
  error: string | null;
  success?: boolean;
}

/**
 * background_jobs now has a per-organisation rate limit enforced by a BEFORE INSERT trigger (see
 * supabase/migrations/20260917000000_background_jobs_org_rate_limit.sql) — at most 5
 * pending/processing jobs per org at once, to stop one org's burst of requests from starving every
 * other org behind it in the worker's single shared queue. That trigger raises a specific Postgres
 * exception message; every job-queuing action below passes its insert error through this helper so
 * the rate-limit case surfaces its own clear copy instead of the generic "check permissions" text.
 */
function backgroundJobInsertErrorMessage(error: { message: string } | null, genericMessage: string): string | null {
  if (!error) return null;
  if (error.message.includes("Too many reports are already queued")) {
    return "Too many reports are already queued for your organisation — wait for one to finish before requesting another.";
  }
  return genericMessage;
}

/**
 * Queues a "generate_monthly_report_pack" background job (R109) for one organisation and one
 * calendar month, aggregated across all of that org's projects. Follows the exact insert-a-row
 * pattern the render_itp_pdf job type already uses (see 20260909270000_phase1_background_jobs.sql)
 * — this action never renders anything itself, the Railway worker does.
 *
 * Admin-only (see isAdminStaff() in apps/web/lib/auth/session.ts, same gate as
 * updateEngagementModeAction in apps/web/lib/numbering/actions.ts) — a monthly report pack is
 * administrative/reporting work, not day-to-day Inspector work, and lives on this same
 * organisation-settings screen. The DB layer also enforces is_jags_staff() + has_org_access() on
 * insert (see 20260910130000_phase3_monthly_report_pack_job.sql) as defence in depth.
 */
export async function generateMonthlyReportPackAction(
  _prev: GenerateMonthlyReportPackState,
  formData: FormData
): Promise<GenerateMonthlyReportPackState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can generate a monthly report pack." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const yearRaw = String(formData.get("year") ?? "").trim();
  const monthRaw = String(formData.get("month") ?? "").trim();

  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);

  if (!organizationId || Number.isNaN(year) || year < 2020 || year > 2100 || Number.isNaN(month) || month < 1 || month > 12) {
    return { error: "Organisation, a valid year and a valid month (1-12) are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "generate_monthly_report_pack",
    payload: {
      organization_id: organizationId,
      year,
      month,
      requested_by: session.userId,
    },
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the monthly report pack. Check you have permission and try again.") };
  }

  revalidatePath("/inspect/organisation/reporting");
  revalidatePath("/inspect/settings");
  return { error: null, success: true };
}

export interface RequestWeeklyReportPackState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "generate_weekly_report_pack" background job for one organisation and one 7-day window
 * starting at `week_start`, aggregated across all of that org's projects. The weekly sibling of
 * generateMonthlyReportPackAction above — same admin-only gate, same insert-a-row pattern, same
 * defence-in-depth DB layer (is_jags_staff() + has_org_access() on insert, see
 * 20260917100000_weekly_report_pack_job.sql), and covered by the same per-org rate-limit trigger
 * (20260917000000_background_jobs_org_rate_limit.sql) since that trigger's org resolver isn't
 * job-type-specific — it now also resolves generate_weekly_report_pack rows by their
 * organization_id, exactly like generate_monthly_report_pack.
 */
export async function requestWeeklyReportPackAction(
  _prev: RequestWeeklyReportPackState,
  formData: FormData
): Promise<RequestWeeklyReportPackState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can generate a weekly report pack." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const weekStart = String(formData.get("week_start") ?? "").trim();

  if (!organizationId || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(Date.parse(weekStart))) {
    return { error: "Organisation and a valid week-starting date are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "generate_weekly_report_pack",
    payload: {
      organization_id: organizationId,
      week_start: weekStart,
      requested_by: session.userId,
    } satisfies WeeklyReportPackPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the weekly report pack. Check you have permission and try again.") };
  }

  revalidatePath("/inspect/organisation/reporting");
  revalidatePath("/inspect/settings");
  return { error: null, success: true };
}

export interface WeeklyReportPackListItem {
  id: string;
  weekStart: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  pdfUrl: string | null;
  pdfDownloadUrl: string | null;
  xlsxUrl: string | null;
  xlsxDownloadUrl: string | null;
}

/**
 * Lists past weekly report packs for an organisation, with signed download URLs — same
 * createSignedUrl pattern as listMonthlyReportPacks below.
 */
export async function listWeeklyReportPacks(organizationId: string): Promise<WeeklyReportPackListItem[]> {
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, job_type, payload, status, result_storage_path, error_message, created_at, completed_at")
    .eq("job_type", "generate_weekly_report_pack")
    .eq("payload->>organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(52) // ~1 year of weekly packs
    .returns<
      (Omit<
        Pick<BackgroundJobRow, "id" | "job_type" | "payload" | "status" | "error_message" | "created_at" | "completed_at">,
        "payload"
      > & { payload: WeeklyReportPackPayload; result_storage_path: string | null })[]
    >();

  const orgJobs = jobs ?? [];

  const items: WeeklyReportPackListItem[] = [];
  for (const job of orgJobs) {
    let pdfUrl: string | null = null;
    let pdfDownloadUrl: string | null = null;
    let xlsxUrl: string | null = null;
    let xlsxDownloadUrl: string | null = null;

    if (job.status === "completed" && job.result_storage_path) {
      const xlsxPath = xlsxPathFromPdfPath(job.result_storage_path);
      const [{ data: pdfSigned }, { data: pdfDownloadSigned }, { data: xlsxSigned }, { data: xlsxDownloadSigned }] = await Promise.all([
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(job.result_storage_path, 3600),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(job.result_storage_path, 3600, { download: true }),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(xlsxPath, 3600),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(xlsxPath, 3600, { download: true }),
      ]);
      pdfUrl = pdfSigned?.signedUrl ?? null;
      pdfDownloadUrl = pdfDownloadSigned?.signedUrl ?? null;
      xlsxUrl = xlsxSigned?.signedUrl ?? null;
      xlsxDownloadUrl = xlsxDownloadSigned?.signedUrl ?? null;
    }

    items.push({
      id: job.id,
      weekStart: job.payload?.week_start,
      status: job.status,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      pdfUrl,
      pdfDownloadUrl,
      xlsxUrl,
      xlsxDownloadUrl,
    });
  }

  return items;
}

export interface RequestItpPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_itp_pdf" background job (R40, R106, R107 — the controlled A4 ITP document).
 * The worker side of this has existed since the background-jobs queue itself was introduced
 * (worker/src/jobs/renderItpPdf.ts, wired into worker/src/index.ts's job-type switch) — this
 * action is the missing other half: nothing in the web app ever inserted a row for it, so there
 * was no way to actually trigger a render. Same insert-a-row pattern as
 * generateMonthlyReportPackAction above; the worker does the rendering, not this action.
 *
 * Any org-scoped user can request a render (not staff-only) — the RLS policy on background_jobs
 * already restricts inserts to users with access to that ITP's project (see
 * 20260909270000_phase1_background_jobs.sql), so this mirrors "who can view the ITP can download
 * it as a PDF."
 */
export async function requestItpPdfAction(_prev: RequestItpPdfState, formData: FormData): Promise<RequestItpPdfState> {
  const session = await requireSession();
  const itpId = String(formData.get("itp_id") ?? "").trim();
  if (!itpId) return { error: "Missing ITP." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_itp_pdf",
    payload: { itp_id: itpId, requested_by: session.userId } satisfies RenderItpPdfPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the PDF. Check you have permission and try again.") };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null, success: true };
}

export interface ItpPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  /** Null until the job actually finishes — used to tell whether the ITP's content/sign-off state
   *  has changed since this specific PDF was rendered (see the ITP page's "stale PDF" banner). */
  completedAt: string | null;
  /** Opens inline in a new tab (no Content-Disposition override) — the "View" option. */
  pdfUrl: string | null;
  /** Same file, signed with { download: true } so Supabase sets Content-Disposition: attachment —
   *  the "Download" option. A plain <a download> attribute doesn't reliably force a save-as dialog
   *  for a cross-origin URL like a Supabase signed URL (browsers ignore it off-origin), so the real
   *  distinction has to come from the response header, not the anchor tag. */
  downloadUrl: string | null;
}

/**
 * The most recent render_itp_pdf job for this ITP (any revision) — enough to show "still
 * rendering" / "ready, here are the links" / "failed". The web client polls this via
 * usePdfPolling (lib/reports/use-pdf-polling.ts) instead of requiring a manual page reload.
 */
export async function getLatestItpPdf(itpId: string): Promise<ItpPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  // Round-table finding: this used to fetch and JSON-parse EVERY render_itp_pdf job ever queued,
  // platform-wide, then find() the matching one in JS — filtering by the JSONB payload column
  // server-side (PostgREST's `payload->>itp_id` path operator) plus a hard limit(1) turns an
  // unbounded, linearly-growing scan into an indexed, single-row lookup.
  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at, completed_at")
    .eq("job_type", "render_itp_pdf")
    .eq("payload->>itp_id", itpId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "payload" | "status" | "error_message" | "created_at" | "completed_at"> & {
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    completedAt: latest.completed_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface RequestInspectionReportPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_inspection_report_pdf" background job (R63-R65, R108 — the general branded A4
 * Inspection Report, distinct from the small IRN certificate). Same insert-a-row pattern as
 * requestItpPdfAction above; RLS on background_jobs already restricts this to users with access to
 * the inspection record's project (20260911010000_phase4_inspection_report_pdf_job.sql).
 */
export async function requestInspectionReportPdfAction(
  _prev: RequestInspectionReportPdfState,
  formData: FormData
): Promise<RequestInspectionReportPdfState> {
  const session = await requireSession();
  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!inspectionRecordId) return { error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("inspection_records")
    .select("id, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<{ id: string; overall_result: string | null }>();
  if (!existing) return { error: "Inspection not found, or you do not have access to it." };
  if (!existing.overall_result) return { error: "The report can only be generated once the inspection is completed." };

  // Don't queue a duplicate while a render for this record is already pending/processing.
  const { data: inFlight } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id")
    .eq("job_type", "render_inspection_report_pdf")
    .eq("payload->>inspection_record_id", inspectionRecordId)
    .in("status", ["pending", "processing"])
    .limit(1);
  if (inFlight && inFlight.length > 0) {
    revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
    return { error: null, success: true };
  }
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_inspection_report_pdf",
    payload: { inspection_record_id: inspectionRecordId, requested_by: session.userId } satisfies RenderInspectionReportPdfPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the report. Check you have permission and try again.") };
  }

  revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
  return { error: null, success: true };
}

export interface InspectionReportPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * The most recent render for this inspection record. Polled client-side via usePdfPolling
 * (lib/reports/use-pdf-polling.ts) — see getLatestItpPdf's doc comment for the View/Download URL
 * split.
 */
export async function getLatestInspectionReportPdf(inspectionRecordId: string): Promise<InspectionReportPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  // See getLatestItpPdf's comment — same server-side-filter + limit(1) fix.
  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_inspection_report_pdf")
    .eq("payload->>inspection_record_id", inspectionRecordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderInspectionReportPdfPayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface RequestFatReportPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_fat_report_pdf" background job (R14 — the report IS the deliverable for a
 * standalone assignment). Same insert-a-row pattern as the ITP/inspection-report actions above.
 */
export async function requestFatReportPdfAction(
  _prev: RequestFatReportPdfState,
  formData: FormData
): Promise<RequestFatReportPdfState> {
  const session = await requireSession();
  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const { data: assignmentRow } = await supabase
    .from("standalone_assignments")
    .select("project_id, status")
    .eq("id", assignmentId)
    .maybeSingle<{ project_id: string; status: string }>();
  if (!assignmentRow) return { error: "Assignment not found." };
  if (!(await canRunStandaloneAssignment(session, supabase, assignmentRow.project_id))) {
    return { error: "Only someone with access to run this assignment can request its report." };
  }
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_fat_report_pdf",
    payload: {
      assignment_id: assignmentId,
      requested_by: session.userId,
      draft: assignmentRow.status !== "completed",
    } satisfies RenderFatReportPdfPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the report. Check you have permission and try again.") };
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null, success: true };
}

export interface FatReportPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * Most recent render for this assignment. Polled client-side via usePdfPolling
 * (lib/reports/use-pdf-polling.ts) — see getLatestItpPdf's doc comment for the View/Download URL
 * split.
 */
export async function getLatestFatReportPdf(assignmentId: string): Promise<FatReportPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  // See getLatestItpPdf's comment — same server-side-filter + limit(1) fix.
  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_fat_report_pdf")
    .eq("payload->>assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderFatReportPdfPayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface RequestNcrPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_ncr_pdf" background job — the branded A4 dossier page for a single NCR (finding
 * + human close-out), matching the client's sample dossier format. Same insert-a-row pattern as
 * requestFatReportPdfAction above; RLS on background_jobs already restricts this to users with
 * access to the NCR's project (20260920020000_ncr_pdf_job.sql).
 */
export async function requestNcrPdfAction(_prev: RequestNcrPdfState, formData: FormData): Promise<RequestNcrPdfState> {
  const session = await requireSession();
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  if (!ncrId) return { error: "Missing NCR." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_ncr_pdf",
    payload: { ncr_id: ncrId, requested_by: session.userId } satisfies RenderNcrPdfPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the PDF. Check you have permission and try again.") };
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  return { error: null, success: true };
}

export interface NcrPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * Most recent render for this NCR. Polled client-side via usePdfPolling
 * (lib/reports/use-pdf-polling.ts) — see getLatestItpPdf's doc comment for the View/Download URL
 * split.
 */
export async function getLatestNcrPdf(ncrId: string): Promise<NcrPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  // See getLatestItpPdf's comment — same server-side-filter + limit(1) fix.
  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_ncr_pdf")
    .eq("payload->>ncr_id", ncrId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderNcrPdfPayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface RequestIrnPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_irn_pdf" background job — the branded A4 IRN (Inspection Release Note)
 * certificate for a single issued IRN. Same insert-a-row pattern as requestNcrPdfAction above; RLS
 * on background_jobs restricts this to users with access to the IRN's inspection record's project
 * (see the render_irn_pdf branches added alongside render_ncr_pdf's own migration).
 */
export async function requestIrnPdfAction(_prev: RequestIrnPdfState, formData: FormData): Promise<RequestIrnPdfState> {
  const session = await requireSession();
  const irnId = String(formData.get("irn_id") ?? "").trim();
  if (!irnId) return { error: "Missing IRN." };

  const supabase = await createSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: irnRow } = await (supabase.from("irns" as never) as any).select("id, voided_at").eq("id", irnId).maybeSingle();
  if (!irnRow) return { error: "IRN not found, or you do not have access to it." };
  if ((irnRow as { voided_at: string | null }).voided_at) {
    return { error: "This IRN has been voided. A PDF cannot be generated for a voided IRN." };
  }
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_irn_pdf",
    payload: { irn_id: irnId, requested_by: session.userId } satisfies RenderIrnPdfPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the PDF. Check you have permission and try again.") };
  }

  revalidatePath(`/inspect/inspections`);
  return { error: null, success: true };
}

export interface IrnPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * Most recent render for this IRN. Polled client-side via usePdfPolling (lib/reports/use-pdf-polling.ts)
 * — see getLatestItpPdf's doc comment for the View/Download URL split.
 */
export async function getLatestIrnPdf(irnId: string): Promise<IrnPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_irn_pdf")
    .eq("payload->>irn_id", irnId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderIrnPdfPayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface RequestDataBookPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_data_book_pdf" background job — the cover-page-plus-compiled-summary PDF for a
 * project's data_books row (R86, R108). Same insert-a-row pattern as requestNcrPdfAction above; RLS
 * on background_jobs restricts this to users with access to the data book's project.
 */
export async function requestDataBookPdfAction(_prev: RequestDataBookPdfState, formData: FormData): Promise<RequestDataBookPdfState> {
  const session = await requireSession();
  const dataBookId = String(formData.get("data_book_id") ?? "").trim();
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!dataBookId) return { error: "Missing data book." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_data_book_pdf",
    payload: { data_book_id: dataBookId, requested_by: session.userId } satisfies RenderDataBookPdfPayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the PDF. Check you have permission and try again.") };
  }

  if (projectId) revalidatePath(`/inspect/projects/${projectId}/data-book`);
  return { error: null, success: true };
}

export interface DataBookPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * Most recent render for this data book. Polled client-side via usePdfPolling
 * (lib/reports/use-pdf-polling.ts) — see getLatestItpPdf's doc comment for the View/Download URL
 * split.
 */
export async function getLatestDataBookPdf(dataBookId: string): Promise<DataBookPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_data_book_pdf")
    .eq("payload->>data_book_id", dataBookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderDataBookPdfPayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface RequestNcrCloseoutCertificateState {
  error: string | null;
  success?: boolean;
}

/**
 * R83: queues a "render_ncr_closeout_certificate" background job — the branded A4 close-out
 * certificate for an NCR that has actually been closed. Distinct from requestNcrPdfAction's
 * "render_ncr_pdf" (a finding+close-out dossier available at any status): closing an NCR previously
 * just flipped status fields with no document produced, which is the gap this closes. Refuses to
 * queue for anything that isn't already closed with its CAPA fields filled in — the same real
 * authority-boundary check the worker (renderNcrCloseoutPdf.ts) repeats server-side, since a status
 * flag on the button alone isn't an authority boundary, same convention as updateNcrAction's own
 * closure gating.
 */
export async function requestNcrCloseoutCertificateAction(
  _prev: RequestNcrCloseoutCertificateState,
  formData: FormData
): Promise<RequestNcrCloseoutCertificateState> {
  const session = await requireSession();
  const ncrId = String(formData.get("ncr_id") ?? "").trim();
  if (!ncrId) return { error: "Missing NCR." };

  const supabase = await createSupabaseServerClient();

  const { data: ncr } = await supabase
    .from(NCRS_TABLE)
    .select("status, root_cause, corrective_action, verification_notes")
    .eq("id", ncrId)
    .maybeSingle<{ status: string; root_cause: string | null; corrective_action: string | null; verification_notes: string | null }>();

  if (!ncr || ncr.status !== "closed" || !ncr.root_cause || !ncr.corrective_action || !ncr.verification_notes) {
    return { error: "This NCR must be closed, with root cause, corrective action and verification recorded, before a close-out certificate can be generated." };
  }

  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_ncr_closeout_certificate",
    payload: { ncr_id: ncrId, requested_by: session.userId } satisfies RenderNcrCloseoutCertificatePayload,
  });

  if (error) {
    return { error: backgroundJobInsertErrorMessage(error, "Could not queue the certificate. Check you have permission and try again.") };
  }

  revalidatePath(`/inspect/ncrs/${ncrId}`);
  return { error: null, success: true };
}

export interface NcrCloseoutCertificateStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * Most recent close-out certificate render for this NCR. Polled client-side via usePdfPolling
 * (lib/reports/use-pdf-polling.ts) — see getLatestItpPdf's doc comment for the View/Download URL
 * split.
 */
export async function getLatestNcrCloseoutCertificate(ncrId: string): Promise<NcrCloseoutCertificateStatus | null> {
  const supabase = await createSupabaseServerClient();

  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_ncr_closeout_certificate")
    .eq("payload->>ncr_id", ncrId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderNcrCloseoutCertificatePayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}

export interface DraftReportNarrativeState {
  error: string | null;
  narrative: string | null;
  aiLogId: string | null;
}

const EMPTY_NARRATIVE_STATE: DraftReportNarrativeState = { error: null, narrative: null, aiLogId: null };

/**
 * Drafts the conclusion paragraph for an Inspection Report (R111: "draft inspection narratives...
 * and report conclusions"). Facts are gathered here from the record's own real data — never
 * trusted from the client — so the model can only summarise what actually happened, not whatever
 * a form field claims. Nothing is saved by this action; saveInspectionNarrativeAction (below) is
 * the separate, explicit "the human reviewed and approved this" step, same split as every other
 * AI draft in this app (e.g. generateItpDraftAction / createItpFromDraftAction).
 */
export async function draftInspectionNarrativeAction(
  _prev: DraftReportNarrativeState,
  formData: FormData
): Promise<DraftReportNarrativeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { ...EMPTY_NARRATIVE_STATE, error: "Only JAGS staff can draft a report narrative." };

  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  if (!inspectionRecordId) return { ...EMPTY_NARRATIVE_STATE, error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: record } = await supabase
    .from("inspection_records")
    .select("activity, project_id, project_name, itp_number, overall_result")
    .eq("id", inspectionRecordId)
    .maybeSingle<{ activity: string; project_id: string; project_name: string; itp_number: string; overall_result: string | null }>();

  if (!record) return { ...EMPTY_NARRATIVE_STATE, error: "Inspection record not found." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_NARRATIVE_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_NARRATIVE_STATE, error: gate.reason };

  const { data: responses } = await supabase
    .from("checklist_responses")
    .select("result")
    .eq("inspection_record_id", inspectionRecordId)
    .returns<{ result: "yes" | "no" | "na" }[]>();

  const counts = { yes: 0, no: 0, na: 0 };
  for (const r of responses ?? []) counts[r.result]++;

  const facts = [
    `${counts.yes + counts.no + counts.na} checklist items checked`,
    `${counts.yes} passed`,
    `${counts.no} failed`,
    `${counts.na} not applicable`,
    `Governing ITP: ${record.itp_number}`,
  ];

  try {
    const cacheInput = {
      reportType: "inspection" as const,
      subject: record.activity,
      projectName: record.project_name,
      outcome: record.overall_result,
      facts,
    };
    const inputHash = hashAiCacheInput(cacheInput);
    const cached = await findCachedAiResponse<string>(supabase, {
      organizationId: project.organization_id,
      feature: "report_narrative_draft",
      promptVersion: PROMPT_VERSIONS.report_narrative_draft,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let narrative: string;
    if (cached) {
      narrative = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.draftReportNarrative(cacheInput));
      narrative = captured.result;
      usage = captured.usage;
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId: record.project_id,
      userId: user?.id ?? null,
      feature: "report_narrative_draft",
      modelId: getGeminiModel("report_narrative_draft"),
      promptVersion: PROMPT_VERSIONS.report_narrative_draft,
      sourceRef: { reportType: "inspection", inspectionRecordId, facts },
      aiResponse: narrative,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, narrative, aiLogId: logId };
  } catch (err) {
    return { ...EMPTY_NARRATIVE_STATE, error: aiErrorMessage(err, "Could not draft a narrative.") };
  }
}

export interface SaveNarrativeState {
  error: string | null;
}

/** Persists the (human-reviewed, possibly hand-edited) narrative onto the inspection record. */
export async function saveInspectionNarrativeAction(_prev: SaveNarrativeState, formData: FormData): Promise<SaveNarrativeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit the report narrative." };

  const inspectionRecordId = String(formData.get("inspection_record_id") ?? "").trim();
  const narrative = sanitizeAiText(String(formData.get("narrative") ?? ""), 4000);
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;
  const aiOriginalNarrative = String(formData.get("ai_original_narrative") ?? "").trim();
  if (!inspectionRecordId) return { error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inspection_records")
    .update({ narrative: narrative || null })
    .eq("id", inspectionRecordId);

  if (error) return { error: "Could not save the narrative. Check you have permission and try again." };

  try {
    const { data: record } = await supabase
      .from("inspection_records")
      .select("record_number, project_id, projects(organization_id)")
      .eq("id", inspectionRecordId)
      .maybeSingle<{ record_number: string; project_id: string; projects: { organization_id: string } | null }>();
    if (record?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: record.projects.organization_id,
        projectId: record.project_id,
        entityType: "inspection_record",
        entityId: inspectionRecordId,
        action: "narrative_saved",
        actorId: session.userId,
        summary: `Report narrative saved for ${record.record_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  if (aiLogId && session.userId) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: session.userId,
      targetType: "inspection_narrative",
      targetId: inspectionRecordId,
      reviewedResponse: { narrative },
      decision: !narrative ? "discarded" : narrative === aiOriginalNarrative ? "accepted_as_is" : "edited_and_accepted",
    });
  }

  revalidatePath(`/inspect/inspections/${inspectionRecordId}`);
  return { error: null };
}

/** Same pattern as draftInspectionNarrativeAction, for a FAT / standalone assignment report. */
export async function draftFatNarrativeAction(
  _prev: DraftReportNarrativeState,
  formData: FormData
): Promise<DraftReportNarrativeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { ...EMPTY_NARRATIVE_STATE, error: "Only JAGS staff can draft a report narrative." };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  if (!assignmentId) return { ...EMPTY_NARRATIVE_STATE, error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: assignment } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .select("equipment_description, project_id, conclusion, projects(name)")
    .eq("id", assignmentId)
    .maybeSingle<{
      equipment_description: string;
      project_id: string;
      conclusion: string | null;
      projects: { name: string } | null;
    }>();

  if (!assignment) return { ...EMPTY_NARRATIVE_STATE, error: "Assignment not found." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", assignment.project_id)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_NARRATIVE_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_NARRATIVE_STATE, error: gate.reason };

  const [{ data: measurements }, { data: punchItems }] = await Promise.all([
    supabase
      .from(STANDALONE_ASSIGNMENT_MEASUREMENTS)
      .select("result")
      .eq("assignment_id", assignmentId)
      .returns<{ result: "pass" | "fail" | null }[]>(),
    supabase
      .from(STANDALONE_ASSIGNMENT_PUNCH_ITEMS)
      .select("status")
      .eq("assignment_id", assignmentId)
      .returns<{ status: "open" | "closed" }[]>(),
  ]);

  const measurementCounts = { pass: 0, fail: 0 };
  for (const m of measurements ?? []) {
    if (m.result === "pass") measurementCounts.pass++;
    else if (m.result === "fail") measurementCounts.fail++;
  }
  const openPunchItems = (punchItems ?? []).filter((p) => p.status === "open").length;

  const facts = [
    `${measurementCounts.pass} measurements within limit`,
    `${measurementCounts.fail} measurements outside limit`,
    `${openPunchItems} open punch-list item(s)`,
  ];

  try {
    const cacheInput = {
      reportType: "fat" as const,
      subject: assignment.equipment_description,
      projectName: assignment.projects?.name ?? "",
      outcome: assignment.conclusion,
      facts,
    };
    const inputHash = hashAiCacheInput(cacheInput);
    const cached = await findCachedAiResponse<string>(supabase, {
      organizationId: project.organization_id,
      feature: "report_narrative_draft",
      promptVersion: PROMPT_VERSIONS.report_narrative_draft,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let narrative: string;
    if (cached) {
      narrative = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.draftReportNarrative(cacheInput));
      narrative = captured.result;
      usage = captured.usage;
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId: assignment.project_id,
      userId: user?.id ?? null,
      feature: "report_narrative_draft",
      modelId: getGeminiModel("report_narrative_draft"),
      promptVersion: PROMPT_VERSIONS.report_narrative_draft,
      sourceRef: { reportType: "fat", assignmentId, facts },
      aiResponse: narrative,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, narrative, aiLogId: logId };
  } catch (err) {
    return { ...EMPTY_NARRATIVE_STATE, error: aiErrorMessage(err, "Could not draft a narrative.") };
  }
}

/** Persists the (human-reviewed, possibly hand-edited) narrative onto the standalone assignment. */
export async function saveFatNarrativeAction(_prev: SaveNarrativeState, formData: FormData): Promise<SaveNarrativeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit the report narrative." };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const narrative = sanitizeAiText(String(formData.get("narrative") ?? ""), 4000);
  const aiLogId = String(formData.get("ai_log_id") ?? "").trim() || null;
  const aiOriginalNarrative = String(formData.get("ai_original_narrative") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({ narrative: narrative || null })
    .eq("id", assignmentId);

  if (error) return { error: "Could not save the narrative. Check you have permission and try again." };

  try {
    const { data: assignmentRow } = await supabase
      .from(STANDALONE_ASSIGNMENTS)
      .select("assignment_number, project_id, projects(organization_id)")
      .eq("id", assignmentId)
      .maybeSingle<{ assignment_number: string; project_id: string; projects: { organization_id: string } | null }>();
    if (assignmentRow?.projects?.organization_id) {
      await recordAuditEvent(supabase, {
        organizationId: assignmentRow.projects.organization_id,
        projectId: assignmentRow.project_id,
        entityType: "standalone_assignment",
        entityId: assignmentId,
        action: "narrative_saved",
        actorId: session.userId,
        summary: `Report narrative saved for ${assignmentRow.assignment_number}`,
      });
    }
  } catch {
    // Best-effort — see lib/audit/log.ts's doc comment.
  }

  if (aiLogId && session.userId) {
    await recordAiReviewDecision(supabase, {
      logId: aiLogId,
      reviewedBy: session.userId,
      targetType: "fat_narrative",
      targetId: assignmentId,
      reviewedResponse: { narrative },
      decision: !narrative ? "discarded" : narrative === aiOriginalNarrative ? "accepted_as_is" : "edited_and_accepted",
    });
  }

  revalidatePath(`/inspect/standalone/${assignmentId}`);
  return { error: null };
}

export interface ReportPackListItem {
  id: string;
  year: number;
  month: number;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  pdfUrl: string | null;
  pdfDownloadUrl: string | null;
  xlsxUrl: string | null;
  xlsxDownloadUrl: string | null;
}

/**
 * Lists past monthly report packs for an organisation, with signed download URLs — same
 * createSignedUrl pattern used for inspection-evidence photos (components/domain/photo-thumbnail.tsx),
 * against the generated-documents bucket the worker uploads into.
 */
export async function listMonthlyReportPacks(organizationId: string): Promise<ReportPackListItem[]> {
  const supabase = await createSupabaseServerClient();

  // Round-table finding: this used to fetch and JSON-parse EVERY org's monthly-report-pack job
  // ever queued, platform-wide, filtering by organization_id in JS. Filtering server-side via the
  // JSONB payload path plus a generous cap (2 years of monthly packs) turns an unbounded,
  // linearly-growing scan into a small, indexed query.
  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, job_type, payload, status, result_storage_path, error_message, created_at, completed_at")
    .eq("job_type", "generate_monthly_report_pack")
    .eq("payload->>organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(24)
    .returns<
      (Omit<
        Pick<BackgroundJobRow, "id" | "job_type" | "payload" | "status" | "error_message" | "created_at" | "completed_at">,
        "payload"
      > & { payload: MonthlyReportPackPayload; result_storage_path: string | null })[]
    >();

  const orgJobs = jobs ?? [];

  const items: ReportPackListItem[] = [];
  for (const job of orgJobs) {
    let pdfUrl: string | null = null;
    let pdfDownloadUrl: string | null = null;
    let xlsxUrl: string | null = null;
    let xlsxDownloadUrl: string | null = null;

    if (job.status === "completed" && job.result_storage_path) {
      const xlsxPath = xlsxPathFromPdfPath(job.result_storage_path);
      const [{ data: pdfSigned }, { data: pdfDownloadSigned }, { data: xlsxSigned }, { data: xlsxDownloadSigned }] = await Promise.all([
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(job.result_storage_path, 3600),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(job.result_storage_path, 3600, { download: true }),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(xlsxPath, 3600),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(xlsxPath, 3600, { download: true }),
      ]);
      pdfUrl = pdfSigned?.signedUrl ?? null;
      pdfDownloadUrl = pdfDownloadSigned?.signedUrl ?? null;
      xlsxUrl = xlsxSigned?.signedUrl ?? null;
      xlsxDownloadUrl = xlsxDownloadSigned?.signedUrl ?? null;
    }

    items.push({
      id: job.id,
      year: job.payload?.year,
      month: job.payload?.month,
      status: job.status,
      errorMessage: job.error_message,
      createdAt: job.created_at,
      completedAt: job.completed_at,
      pdfUrl,
      pdfDownloadUrl,
      xlsxUrl,
      xlsxDownloadUrl,
    });
  }

  return items;
}

export interface RequestPortfolioSummaryPdfState {
  error: string | null;
  success?: boolean;
}

/**
 * Queues a "render_portfolio_summary_pdf" background job — the one-click "Export portfolio summary
 * (PDF)" button (round-table market-readiness finding: an admin had no way to get a single PDF
 * summary of the whole portfolio to send a stakeholder, short of compiling per-project reports by
 * hand). Same insert-a-row pattern as generateMonthlyReportPackAction above; admin-gated here (same
 * isAdminStaff() check the monthly report pack action uses) AND at the DB layer via
 * is_jags_staff() on background_jobs_insert (20260916150000_portfolio_summary_pdf_job.sql) as
 * defence in depth — unlike every other job_type here, this one has no organization_id/project_id
 * on the payload to scope by, since it deliberately covers the whole portfolio.
 */
export async function requestPortfolioSummaryPdfAction(
  _prev: RequestPortfolioSummaryPdfState,
  _formData: FormData
): Promise<RequestPortfolioSummaryPdfState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { error: "Only a JAGS Admin can export a portfolio summary." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_portfolio_summary_pdf",
    payload: { requested_by: session.userId } satisfies RenderPortfolioSummaryPdfPayload,
  });

  if (error) {
    return { error: "Could not queue the portfolio summary. Check you have permission and try again." };
  }

  revalidatePath("/inspect/organisation/insights");
  return { error: null, success: true };
}

export interface PortfolioSummaryPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
  downloadUrl: string | null;
}

/**
 * The most recent render_portfolio_summary_pdf job requested by THIS user — polled client-side via
 * usePdfPolling (lib/reports/use-pdf-polling.ts), same as getLatestItpPdf, but scoped to the current
 * session's own requests (there's no shared target id like an itp_id to filter by; every admin's own
 * last export is what they care about seeing). RLS (background_jobs_select) also restricts this to
 * jobs either requested by this user or visible under the is_jags_staff() portfolio-summary branch,
 * so a non-admin session simply sees no rows here even if this were ever called for one.
 */
export interface GenerateReportSummaryState {
  error: string | null;
  summary: string | null;
}

const EMPTY_REPORT_SUMMARY_STATE: GenerateReportSummaryState = { error: null, summary: null };

/**
 * R111 (4/4): the monthly report pack's AI executive summary — see lib/reports/report-summary.ts's
 * doc comment for why this runs web-side rather than in the worker. Same admin-only gate as
 * generateMonthlyReportPackAction (this is administrative/reporting work, on the same screen);
 * computes the real aggregated numbers itself rather than trusting anything from the client, then
 * summarises them. Never written anywhere — it's a display-only paragraph the admin can read
 * alongside the queued PDF/xlsx, not embedded into either.
 */
export async function generateReportPackSummaryAction(
  _prev: GenerateReportSummaryState,
  formData: FormData
): Promise<GenerateReportSummaryState> {
  const session = await requireSession();
  if (!isAdminStaff(session)) {
    return { ...EMPTY_REPORT_SUMMARY_STATE, error: "Only a JAGS Admin can generate an AI summary." };
  }

  const organizationId = String(formData.get("organization_id") ?? "").trim();
  const year = Number.parseInt(String(formData.get("year") ?? ""), 10);
  const month = Number.parseInt(String(formData.get("month") ?? ""), 10);

  if (!organizationId || Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
    return { ...EMPTY_REPORT_SUMMARY_STATE, error: "Organisation, a valid year and a valid month (1-12) are required." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const gate = await assertAiAllowed(supabase, organizationId);
  if (!gate.allowed) return { ...EMPTY_REPORT_SUMMARY_STATE, error: gate.reason };

  const MONTH_NAMES_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 0, 0, 0));
  const periodLabel = `${MONTH_NAMES_FULL[month - 1]} ${year}`;

  try {
    const agg = await aggregateReportSummaryData(supabase, organizationId, start.toISOString(), end.toISOString());
    // Re-clicking "generate AI summary" for the same period before the underlying numbers have
    // changed (a real pattern — nothing here auto-runs it, and the admin may just be re-reading it
    // alongside the queued PDF) reuses the prior summary instead of a fresh call.
    const cacheInput = {
      periodLabel,
      firstTimePassRate: agg.firstTimePassRate,
      inspectionsCompleted: agg.inspectionsCompleted,
      ncrsOpened: agg.ncrsOpened,
      ncrsClosed: agg.ncrsClosed,
      itpCompletionRate: agg.itpCompletionRate,
      projectCount: agg.projectCount,
    };
    const inputHash = hashAiCacheInput(cacheInput);
    const cached = await findCachedAiResponse<string>(supabase, {
      organizationId,
      feature: "report_pack_summary",
      promptVersion: PROMPT_VERSIONS.report_pack_summary,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let summary: string;
    if (cached) {
      summary = cached;
    } else {
      const captured = await withGeminiUsage(() =>
        geminiProvider.summarizeReportPack({
          organizationName: agg.organizationName,
          ...cacheInput,
        })
      );
      summary = captured.result;
      usage = captured.usage;
    }
    await logAiUsage(supabase, {
      organizationId,
      userId: user?.id ?? null,
      feature: "report_pack_summary",
      modelId: getGeminiModel("report_pack_summary"),
      promptVersion: PROMPT_VERSIONS.report_pack_summary,
      sourceRef: { organizationId, year, month },
      aiResponse: summary,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, summary };
  } catch (err) {
    return { ...EMPTY_REPORT_SUMMARY_STATE, error: aiErrorMessage(err, "Could not generate a summary.") };
  }
}

export interface CleanUpNarrativeState {
  error: string | null;
  cleaned: string | null;
  aiLogId: string | null;
}

const EMPTY_CLEANUP_STATE: CleanUpNarrativeState = { error: null, cleaned: null, aiLogId: null };

/**
 * R111: grammar/clarity clean-up for the report narrative textarea (shared by NarrativeEditor for
 * both the Inspection Report and the FAT Report). Sends exactly the text currently typed into the
 * textarea — never a previously-saved narrative re-fetched server-side — and returns a suggestion
 * only; the person reviews it and either edits/saves it via the existing save action or discards it
 * by simply not using it. Nothing here ever writes to inspection_records/standalone_assignments.
 */
export async function cleanUpNarrativeAction(
  _prev: CleanUpNarrativeState,
  formData: FormData
): Promise<CleanUpNarrativeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { ...EMPTY_CLEANUP_STATE, error: "Only JAGS staff can use the clean-up assist." };

  const projectId = String(formData.get("project_id") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();
  if (!projectId || !text) return { ...EMPTY_CLEANUP_STATE, error: "Nothing to clean up yet — type some text first." };

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle<{ organization_id: string }>();

  if (!project) return { ...EMPTY_CLEANUP_STATE, error: "Project not found." };

  const gate = await assertAiAllowed(supabase, project.organization_id);
  if (!gate.allowed) return { ...EMPTY_CLEANUP_STATE, error: gate.reason };

  try {
    const inputHash = hashAiCacheInput(text);
    const cached = await findCachedAiResponse<string>(supabase, {
      organizationId: project.organization_id,
      feature: "text_cleanup",
      promptVersion: PROMPT_VERSIONS.text_cleanup,
      inputHash,
    });
    let usage: GeminiTokenUsage | null = null;
    let cleaned: string;
    if (cached) {
      cleaned = cached;
    } else {
      const captured = await withGeminiUsage(() => geminiProvider.cleanUpText({ text }));
      cleaned = captured.result;
      usage = captured.usage;
    }
    const logId = await logAiUsage(supabase, {
      organizationId: project.organization_id,
      projectId,
      userId: user?.id ?? null,
      feature: "text_cleanup",
      modelId: getGeminiModel("text_cleanup"),
      promptVersion: PROMPT_VERSIONS.text_cleanup,
      sourceRef: { projectId },
      aiResponse: cleaned,
      inputHash,
      servedFromCache: !!cached,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { error: null, cleaned, aiLogId: logId };
  } catch (err) {
    return { ...EMPTY_CLEANUP_STATE, error: aiErrorMessage(err, "Could not clean up this text.") };
  }
}

export async function getLatestPortfolioSummaryPdf(): Promise<PortfolioSummaryPdfStatus | null> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return null;

  const supabase = await createSupabaseServerClient();

  // See getLatestItpPdf's comment — same server-side-filter + limit(1) fix.
  const { data: latest } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_portfolio_summary_pdf")
    .eq("payload->>requested_by", session.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderPortfolioSummaryPdfPayload;
        result_storage_path: string | null;
      }
    >();

  if (!latest) return null;

  let pdfUrl: string | null = null;
  let downloadUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const [{ data: viewSigned }, { data: downloadSigned }] = await Promise.all([
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600),
      supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(latest.result_storage_path, 3600, { download: true }),
    ]);
    pdfUrl = viewSigned?.signedUrl ?? null;
    downloadUrl = downloadSigned?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
    downloadUrl,
  };
}
