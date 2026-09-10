"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { BACKGROUND_JOBS_TABLE, GENERATED_DOCUMENTS_BUCKET, csvPathFromPdfPath, type BackgroundJobRow } from "./types";

export interface GenerateMonthlyReportPackState {
  error: string | null;
  success?: boolean;
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

  if (!organizationId || Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
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
    return { error: "Could not queue the monthly report pack. Check you have permission and try again." };
  }

  revalidatePath("/inspect/organisation/numbering");
  return { error: null, success: true };
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
  csvUrl: string | null;
}

/**
 * Lists past monthly report packs for an organisation, with signed download URLs — same
 * createSignedUrl pattern used for inspection-evidence photos (components/domain/photo-thumbnail.tsx),
 * against the generated-documents bucket the worker uploads into.
 */
export async function listMonthlyReportPacks(organizationId: string): Promise<ReportPackListItem[]> {
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, job_type, payload, status, result_storage_path, error_message, created_at, completed_at")
    .eq("job_type", "generate_monthly_report_pack")
    .order("created_at", { ascending: false })
    .returns<
      (Pick<BackgroundJobRow, "id" | "job_type" | "payload" | "status" | "error_message" | "created_at" | "completed_at"> & {
        result_storage_path: string | null;
      })[]
    >();

  const orgJobs = (jobs ?? []).filter((job) => job.payload?.organization_id === organizationId);

  const items: ReportPackListItem[] = [];
  for (const job of orgJobs) {
    let pdfUrl: string | null = null;
    let csvUrl: string | null = null;

    if (job.status === "completed" && job.result_storage_path) {
      const [{ data: pdfSigned }, { data: csvSigned }] = await Promise.all([
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(job.result_storage_path, 3600),
        supabase.storage.from(GENERATED_DOCUMENTS_BUCKET).createSignedUrl(csvPathFromPdfPath(job.result_storage_path), 3600),
      ]);
      pdfUrl = pdfSigned?.signedUrl ?? null;
      csvUrl = csvSigned?.signedUrl ?? null;
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
      csvUrl,
    });
  }

  return items;
}
