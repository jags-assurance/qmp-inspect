"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession, isAdminStaff } from "@/lib/auth/session";
import { assertAiAllowed } from "@/lib/ai/gate";
import { logAiUsage } from "@/lib/ai/log";
import { geminiProvider } from "@/lib/ai/gemini-provider";
import {
  STANDALONE_ASSIGNMENTS,
  STANDALONE_ASSIGNMENT_MEASUREMENTS,
  STANDALONE_ASSIGNMENT_PUNCH_ITEMS,
} from "@/lib/standalone/types";
import {
  BACKGROUND_JOBS_TABLE,
  GENERATED_DOCUMENTS_BUCKET,
  csvPathFromPdfPath,
  type BackgroundJobRow,
  type MonthlyReportPackPayload,
  type RenderFatReportPdfPayload,
  type RenderInspectionReportPdfPayload,
  type RenderItpPdfPayload,
  type RenderPortfolioSummaryPdfPayload,
} from "./types";

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
    return { error: "Could not queue the PDF. Check you have permission and try again." };
  }

  revalidatePath(`/inspect/itps/${itpId}`);
  return { error: null, success: true };
}

export interface ItpPdfStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  pdfUrl: string | null;
}

/**
 * The most recent render_itp_pdf job for this ITP (any revision) — enough to show "still
 * rendering" / "ready, here's the link" / "failed" without a dedicated polling endpoint. A user
 * reloads the page to see progress, same UX as listMonthlyReportPacks below (no client-side
 * polling exists anywhere else in this app either).
 */
export async function getLatestItpPdf(itpId: string): Promise<ItpPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  const { data: job } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_itp_pdf")
    .order("created_at", { ascending: false })
    .returns<
      (Pick<BackgroundJobRow, "id" | "payload" | "status" | "error_message" | "created_at"> & {
        result_storage_path: string | null;
      })[]
    >();

  const latest = (job ?? []).find((j) => (j.payload as RenderItpPdfPayload).itp_id === itpId);
  if (!latest) return null;

  let pdfUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const { data: signed } = await supabase.storage
      .from(GENERATED_DOCUMENTS_BUCKET)
      .createSignedUrl(latest.result_storage_path, 3600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
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
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_inspection_report_pdf",
    payload: { inspection_record_id: inspectionRecordId, requested_by: session.userId } satisfies RenderInspectionReportPdfPayload,
  });

  if (error) {
    return { error: "Could not queue the report. Check you have permission and try again." };
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
}

/** The most recent render for this inspection record — same "reload to see progress" pattern as getLatestItpPdf. */
export async function getLatestInspectionReportPdf(inspectionRecordId: string): Promise<InspectionReportPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_inspection_report_pdf")
    .order("created_at", { ascending: false })
    .returns<
      (Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderInspectionReportPdfPayload;
        result_storage_path: string | null;
      })[]
    >();

  const latest = (jobs ?? []).find((j) => j.payload.inspection_record_id === inspectionRecordId);
  if (!latest) return null;

  let pdfUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const { data: signed } = await supabase.storage
      .from(GENERATED_DOCUMENTS_BUCKET)
      .createSignedUrl(latest.result_storage_path, 3600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
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
  const { error } = await supabase.from(BACKGROUND_JOBS_TABLE).insert({
    job_type: "render_fat_report_pdf",
    payload: { assignment_id: assignmentId, requested_by: session.userId } satisfies RenderFatReportPdfPayload,
  });

  if (error) {
    return { error: "Could not queue the report. Check you have permission and try again." };
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
}

/** Most recent render for this assignment — same "reload to see progress" pattern as the others. */
export async function getLatestFatReportPdf(assignmentId: string): Promise<FatReportPdfStatus | null> {
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_fat_report_pdf")
    .order("created_at", { ascending: false })
    .returns<
      (Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderFatReportPdfPayload;
        result_storage_path: string | null;
      })[]
    >();

  const latest = (jobs ?? []).find((j) => j.payload.assignment_id === assignmentId);
  if (!latest) return null;

  let pdfUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const { data: signed } = await supabase.storage
      .from(GENERATED_DOCUMENTS_BUCKET)
      .createSignedUrl(latest.result_storage_path, 3600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
  };
}

export interface DraftReportNarrativeState {
  error: string | null;
  narrative: string | null;
}

const EMPTY_NARRATIVE_STATE: DraftReportNarrativeState = { error: null, narrative: null };

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
    const narrative = await geminiProvider.draftReportNarrative({
      reportType: "inspection",
      subject: record.activity,
      projectName: record.project_name,
      outcome: record.overall_result,
      facts,
    });
    await logAiUsage(supabase, { organizationId: project.organization_id, userId: user?.id ?? null, feature: "report_narrative_draft" });
    return { error: null, narrative };
  } catch (err) {
    return { ...EMPTY_NARRATIVE_STATE, error: err instanceof Error ? err.message : "Could not draft a narrative." };
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
  const narrative = String(formData.get("narrative") ?? "").trim();
  if (!inspectionRecordId) return { error: "Missing inspection record." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("inspection_records")
    .update({ narrative: narrative || null })
    .eq("id", inspectionRecordId);

  if (error) return { error: "Could not save the narrative. Check you have permission and try again." };

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
    const narrative = await geminiProvider.draftReportNarrative({
      reportType: "fat",
      subject: assignment.equipment_description,
      projectName: assignment.projects?.name ?? "",
      outcome: assignment.conclusion,
      facts,
    });
    await logAiUsage(supabase, { organizationId: project.organization_id, userId: user?.id ?? null, feature: "report_narrative_draft" });
    return { error: null, narrative };
  } catch (err) {
    return { ...EMPTY_NARRATIVE_STATE, error: err instanceof Error ? err.message : "Could not draft a narrative." };
  }
}

/** Persists the (human-reviewed, possibly hand-edited) narrative onto the standalone assignment. */
export async function saveFatNarrativeAction(_prev: SaveNarrativeState, formData: FormData): Promise<SaveNarrativeState> {
  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can edit the report narrative." };

  const assignmentId = String(formData.get("assignment_id") ?? "").trim();
  const narrative = String(formData.get("narrative") ?? "").trim();
  if (!assignmentId) return { error: "Missing assignment." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from(STANDALONE_ASSIGNMENTS)
    .update({ narrative: narrative || null })
    .eq("id", assignmentId);

  if (error) return { error: "Could not save the narrative. Check you have permission and try again." };

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
      (Omit<
        Pick<BackgroundJobRow, "id" | "job_type" | "payload" | "status" | "error_message" | "created_at" | "completed_at">,
        "payload"
      > & { payload: MonthlyReportPackPayload; result_storage_path: string | null })[]
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
}

/**
 * The most recent render_portfolio_summary_pdf job requested by THIS user — same "reload to see
 * progress" pattern as getLatestItpPdf, but scoped to the current session's own requests (there's
 * no shared target id like an itp_id to filter by; every admin's own last export is what they care
 * about seeing). RLS (background_jobs_select) also restricts this to jobs either requested by this
 * user or visible under the is_jags_staff() portfolio-summary branch, so a non-admin session simply
 * sees no rows here even if this were ever called for one.
 */
export async function getLatestPortfolioSummaryPdf(): Promise<PortfolioSummaryPdfStatus | null> {
  const session = await requireSession();
  if (!isAdminStaff(session)) return null;

  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from(BACKGROUND_JOBS_TABLE)
    .select("id, payload, status, result_storage_path, error_message, created_at")
    .eq("job_type", "render_portfolio_summary_pdf")
    .order("created_at", { ascending: false })
    .returns<
      (Pick<BackgroundJobRow, "id" | "status" | "error_message" | "created_at"> & {
        payload: RenderPortfolioSummaryPdfPayload;
        result_storage_path: string | null;
      })[]
    >();

  const latest = (jobs ?? []).find((j) => j.payload.requested_by === session.userId);
  if (!latest) return null;

  let pdfUrl: string | null = null;
  if (latest.status === "completed" && latest.result_storage_path) {
    const { data: signed } = await supabase.storage
      .from(GENERATED_DOCUMENTS_BUCKET)
      .createSignedUrl(latest.result_storage_path, 3600);
    pdfUrl = signed?.signedUrl ?? null;
  }

  return {
    id: latest.id,
    status: latest.status,
    errorMessage: latest.error_message,
    createdAt: latest.created_at,
    pdfUrl,
  };
}
