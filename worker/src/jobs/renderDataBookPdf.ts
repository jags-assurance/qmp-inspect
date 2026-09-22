import puppeteer from "puppeteer";
import { supabase } from "../supabase";
import {
  buildDataBookPdfHtml,
  type DataBookPdfCategory,
  type DataBookPdfData,
  type DataBookPdfDisciplineRow,
} from "./dataBookTemplate";
import type { RenderDataBookPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface DataBookRow {
  id: string;
  project_id: string;
  book_number: string;
  title: string;
  status: "draft" | "compiled" | "issued";
  compiled_at: string | null;
  override_reason: string | null;
}

function toCategory(label: string, ready: number, total: number): DataBookPdfCategory {
  return { label, ready, total, percentage: total === 0 ? 100 : Math.round((ready / total) * 100) };
}

/**
 * Re-derives apps/web/lib/databook/readiness.ts's computeDataBookReadiness for this worker process.
 * Not a straight import: that module goes through createSupabaseServerClient() (Next.js
 * cookie-bound, server-only) which the worker has no access to — the worker only ever holds a
 * service-role Supabase client (../supabase). Every category, formula, and gating rule below is
 * kept identical to readiness.ts on purpose; if that file's categories or thresholds ever change,
 * this needs the same change made here.
 */
async function computeDataBookReadinessForWorker(projectId: string): Promise<{
  categories: DataBookPdfCategory[];
  handoverCertificate: DataBookPdfCategory;
  openPunchItems: number;
  overallPercentage: number;
  isReady: boolean;
}> {
  const [
    { data: itps },
    { data: inspectionRecords },
    { data: ncrs },
    { count: openPunchItems },
    { data: calibrationRows },
    { data: welderRows },
    { data: materialRows },
    { data: issuedDataBooks },
  ] = await Promise.all([
    supabase.from("itps").select("id, status").eq("project_id", projectId).returns<{ id: string; status: string }[]>(),
    supabase
      .from("inspection_records")
      .select("id, checklist_template_id, overall_result, irns(id)")
      .eq("project_id", projectId)
      .returns<
        {
          id: string;
          checklist_template_id: string | null;
          overall_result: string | null;
          irns: { id: string }[] | { id: string } | null;
        }[]
      >(),
    supabase.from("ncrs" as never).select("id, status").eq("project_id", projectId).returns<{ id: string; status: string }[]>(),
    supabase
      .from("punch_list_items" as never)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "open"),
    supabase
      .from("calibration_register" as never)
      .select("id, status")
      .eq("project_id", projectId)
      .returns<{ id: string; status: string }[]>(),
    supabase
      .from("welder_qualification_register" as never)
      .select("id, status")
      .eq("project_id", projectId)
      .returns<{ id: string; status: string }[]>(),
    supabase
      .from("material_register" as never)
      .select("id, approval_status, receipt_status")
      .eq("project_id", projectId)
      .returns<{ id: string; approval_status: string; receipt_status: string }[]>(),
    supabase.from("data_books" as never).select("id").eq("project_id", projectId).eq("status", "issued").returns<{ id: string }[]>(),
  ]);

  const itpTotal = itps?.length ?? 0;
  const itpReady = (itps ?? []).filter((itp) => itp.status === "approved" || itp.status === "client_accepted").length;

  const recordTotal = inspectionRecords?.length ?? 0;
  const recordReady = (inspectionRecords ?? []).filter((record) =>
    Array.isArray(record.irns) ? record.irns.length > 0 : record.irns !== null
  ).length;

  const { data: itpIdsForProject } = await supabase.from("itps").select("id").eq("project_id", projectId);
  const itpIds = (itpIdsForProject ?? []).map((i: { id: string }) => i.id);
  let checklistTotal = 0;
  let checklistReady = 0;
  if (itpIds.length > 0) {
    const { data: sections } = await supabase.from("itp_sections").select("id").in("itp_id", itpIds);
    const sectionIds = (sections ?? []).map((s: { id: string }) => s.id);
    if (sectionIds.length > 0) {
      const { data: items } = await supabase.from("itp_items").select("id").in("section_id", sectionIds).eq("evidence_type", 1);
      const itemIds = (items ?? []).map((i: { id: string }) => i.id);
      if (itemIds.length > 0) {
        const { data: templates } = await supabase
          .from("checklist_templates" as never)
          .select("id")
          .in("itp_item_id", itemIds)
          .returns<{ id: string }[]>();
        checklistTotal = templates?.length ?? 0;
        const completedTemplateIds = new Set(
          (inspectionRecords ?? [])
            .filter((r) => r.checklist_template_id && r.overall_result !== null)
            .map((r) => r.checklist_template_id as string)
        );
        checklistReady = (templates ?? []).filter((t) => completedTemplateIds.has(t.id)).length;
      }
    }
  }

  const ncrTotal = ncrs?.length ?? 0;
  const ncrReady = (ncrs ?? []).filter((ncr) => ncr.status === "closed").length;

  const calibrationTotal = calibrationRows?.length ?? 0;
  const calibrationReady = (calibrationRows ?? []).filter((r) => r.status !== "expired").length;

  const welderTotal = welderRows?.length ?? 0;
  const welderReady = (welderRows ?? []).filter((r) => r.status !== "expired").length;

  const materialTotal = materialRows?.length ?? 0;
  const materialReady = (materialRows ?? []).filter(
    (r) => (r.approval_status === "A" || r.approval_status === "B") && r.receipt_status === "released"
  ).length;

  const itpsCategory = toCategory("ITPs approved or client-accepted", itpReady, itpTotal);
  const inspectionRecordsCategory = toCategory("Inspection records with an issued IRN", recordReady, recordTotal);
  const checklistsCategory = toCategory("Completed checklists", checklistReady, checklistTotal);
  const calibrationCategory = toCategory("Calibration certificates in date", calibrationReady, calibrationTotal);
  const welderCategory = toCategory("Welder qualifications valid", welderReady, welderTotal);
  const materialCategory = toCategory("Materials approved and released", materialReady, materialTotal);
  const ncrsCategory = toCategory("NCRs closed", ncrReady, ncrTotal);
  const handoverCertificateCategory = toCategory("Handover certificate issued", (issuedDataBooks?.length ?? 0) > 0 ? 1 : 0, 1);

  const gatingCategories = [
    itpsCategory,
    inspectionRecordsCategory,
    checklistsCategory,
    calibrationCategory,
    welderCategory,
    materialCategory,
    ncrsCategory,
  ];
  const totalReady = gatingCategories.reduce((sum, c) => sum + c.ready, 0);
  const totalRequired = gatingCategories.reduce((sum, c) => sum + c.total, 0);
  const overallPercentage = totalRequired === 0 ? 100 : Math.round((totalReady / totalRequired) * 100);
  const openPunchItemCount = openPunchItems ?? 0;

  return {
    categories: gatingCategories,
    handoverCertificate: handoverCertificateCategory,
    openPunchItems: openPunchItemCount,
    overallPercentage,
    isReady: gatingCategories.every((c) => c.percentage === 100) && openPunchItemCount === 0,
  };
}

/**
 * Re-derives apps/web/lib/databook/discipline-breakdown.ts's computeDataBookDisciplineBreakdown for
 * this worker process (R88) — same reason and same convention as
 * computeDataBookReadinessForWorker above: the worker has no access to createSupabaseServerClient,
 * so the same aggregation over the same tables is re-derived here rather than imported. An
 * itp_item with no discipline_id, or an ncr with no itp_item_id, is excluded from every discipline
 * bucket — never guessed at or dumped into a fake "Unassigned" row.
 */
async function computeDataBookDisciplineBreakdownForWorker(projectId: string): Promise<DataBookPdfDisciplineRow[]> {
  const { data: itps } = await supabase.from("itps").select("id").eq("project_id", projectId).returns<{ id: string }[]>();
  const itpIds = (itps ?? []).map((itp) => itp.id);
  if (itpIds.length === 0) return [];

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id, itp_id")
    .in("itp_id", itpIds)
    .returns<{ id: string; itp_id: string }[]>();
  const sectionIds = (sections ?? []).map((s) => s.id);
  const sectionToItp = new Map((sections ?? []).map((s) => [s.id, s.itp_id]));
  if (sectionIds.length === 0) return [];

  const { data: items } = await supabase
    .from("itp_items")
    .select("id, section_id, discipline_id")
    .in("section_id", sectionIds)
    .not("discipline_id", "is", null)
    .returns<{ id: string; section_id: string; discipline_id: string }[]>();
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return [];

  const disciplineByItem = new Map(items!.map((i) => [i.id, i.discipline_id]));
  const itpByItem = new Map(items!.map((i) => [i.id, sectionToItp.get(i.section_id) ?? null]));

  const { data: records } = await supabase
    .from("inspection_records")
    .select("itp_item_id, overall_result, created_at")
    .in("itp_item_id", itemIds)
    .order("created_at", { ascending: true })
    .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string }[]>();

  const { data: ncrsRaw } = await supabase
    .from("ncrs" as never)
    .select("id, itp_item_id")
    .eq("project_id", projectId)
    .returns<{ id: string; itp_item_id: string | null }[]>();
  const ncrs = (ncrsRaw ?? []).filter((n): n is { id: string; itp_item_id: string } => n.itp_item_id !== null);

  const firstAttemptByItem = new Map<string, { overall_result: "pass" | "fail" | "partial" | null }>();
  for (const record of records ?? []) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }

  interface DisciplineAgg {
    itpIds: Set<string>;
    ncrCount: number;
    firstAttempts: number;
    firstTimePasses: number;
  }
  const byDiscipline = new Map<string, DisciplineAgg>();
  function agg(disciplineId: string): DisciplineAgg {
    let entry = byDiscipline.get(disciplineId);
    if (!entry) {
      entry = { itpIds: new Set(), ncrCount: 0, firstAttempts: 0, firstTimePasses: 0 };
      byDiscipline.set(disciplineId, entry);
    }
    return entry;
  }

  for (const item of items ?? []) {
    const itpId = itpByItem.get(item.id);
    if (itpId) agg(item.discipline_id).itpIds.add(itpId);
  }

  for (const [itemId, record] of firstAttemptByItem) {
    if (record.overall_result === null) continue;
    const disciplineId = disciplineByItem.get(itemId);
    if (!disciplineId) continue;
    const entry = agg(disciplineId);
    entry.firstAttempts += 1;
    if (record.overall_result === "pass") entry.firstTimePasses += 1;
  }

  for (const ncr of ncrs) {
    const disciplineId = disciplineByItem.get(ncr.itp_item_id);
    if (!disciplineId) continue;
    agg(disciplineId).ncrCount += 1;
  }

  if (byDiscipline.size === 0) return [];

  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .in("id", [...byDiscipline.keys()])
    .returns<{ id: string; code: string; name: string }[]>();
  const disciplineById = new Map((disciplines ?? []).map((d) => [d.id, d]));

  return [...byDiscipline.entries()]
    .map(([disciplineId, entry]) => {
      const discipline = disciplineById.get(disciplineId);
      return {
        disciplineCode: discipline?.code ?? "—",
        disciplineName: discipline?.name ?? "Unknown discipline",
        itpCount: entry.itpIds.size,
        ncrCount: entry.ncrCount,
        firstAttempts: entry.firstAttempts,
        firstTimePasses: entry.firstTimePasses,
        firstTimePassRate: entry.firstAttempts > 0 ? Math.round((entry.firstTimePasses / entry.firstAttempts) * 100) : null,
      };
    })
    .sort((a, b) => a.disciplineCode.localeCompare(b.disciplineCode));
}

/**
 * Fetches everything needed for the branded, cover-page-plus-summary Data Book PDF (R86, R108),
 * renders it via Puppeteer, uploads the result to Storage, and returns the path the caller records
 * on the job row. Mirrors renderNcrPdf.ts's structure exactly, for Data Book data instead of NCR
 * data.
 */
export async function renderDataBookPdf(payload: RenderDataBookPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: dataBook, error: dataBookError } = await supabase
    .from("data_books" as never)
    .select("id, project_id, book_number, title, status, compiled_at, override_reason")
    .eq("id", payload.data_book_id)
    .single<DataBookRow>();

  if (dataBookError || !dataBook) {
    throw new Error(`Data book ${payload.data_book_id} not found: ${dataBookError?.message ?? "no row"}`);
  }

  const [{ data: project }, readiness, disciplineBreakdown] = await Promise.all([
    supabase
      .from("projects")
      .select("organization_id, project_number, name, organizations(name)")
      .eq("id", dataBook.project_id)
      .maybeSingle<{
        organization_id: string;
        project_number: string;
        name: string;
        organizations: { name: string } | null;
      }>(),
    computeDataBookReadinessForWorker(dataBook.project_id),
    computeDataBookDisciplineBreakdownForWorker(dataBook.project_id),
  ]);

  const templateData: DataBookPdfData = {
    bookNumber: dataBook.book_number,
    title: dataBook.title,
    status: dataBook.status,
    projectName: project?.name ?? "",
    projectNumber: project?.project_number ?? "",
    organizationName: project?.organizations?.name ?? null,
    categories: readiness.categories,
    handoverCertificate: readiness.handoverCertificate,
    disciplineBreakdown,
    openPunchItems: readiness.openPunchItems,
    overallPercentage: readiness.overallPercentage,
    isReady: readiness.isReady,
    compiledAt: dataBook.compiled_at,
    overrideReason: dataBook.override_reason,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  const html = buildDataBookPdfHtml(templateData);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "20mm", left: "15mm" },
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: `
          <div style="width:100%;font-size:7.5px;color:#666;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial,Helvetica,sans-serif;">
            <span>Generated by QMP Inspect — JAGS Assurance</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      })
    );
  } finally {
    await browser.close();
  }

  const storagePath = `databooks/${dataBook.id}/${dataBook.book_number}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload rendered PDF: ${uploadError.message}`);
  }

  return { resultStoragePath: storagePath };
}
