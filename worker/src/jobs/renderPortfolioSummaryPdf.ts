import { fileOrgPackInProjectVaults } from "./vaultAutoFile";
import { getSharedBrowser } from "../browserPool";
import { supabase } from "../supabase";
import {
  buildPortfolioSummaryHtml,
  type PortfolioSummaryProjectRow,
  type PortfolioSummaryTemplateData,
} from "./portfolioSummaryTemplate";
import type { RenderPortfolioSummaryPdfPayload } from "./types";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface ProjectRow {
  id: string;
  project_number: string;
  name: string;
  organization_id: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  engagement_mode: string | null;
  brand_primary_color: string | null;
}

interface ItpRow {
  id: string;
  project_id: string;
  status: "draft" | "under_review" | "approved" | "client_accepted";
}

interface ItpSectionRow {
  id: string;
  itp_id: string;
}

interface ItpItemRow {
  id: string;
  section_id: string;
  evidence_type: 1 | 2 | 3;
}

interface InspectionRecordRow {
  id: string;
  project_id: string;
  itp_item_id: string;
  overall_result: "pass" | "fail" | "partial" | null;
  created_at: string;
}

interface NcrRow {
  id: string;
  project_id: string;
  status: string;
}

/**
 * Renders the "Export portfolio summary (PDF)" report (round-table market-readiness finding: an
 * admin had no one-click way to get a single PDF summary of the whole portfolio to send a
 * stakeholder). Portfolio-wide, JAGS-internal — this queries EVERY project (the worker runs with
 * the service-role key, and only is_jags_staff() admins can queue this job_type per the RLS
 * with-check on background_jobs, see 20260916150000_portfolio_summary_pdf_job.sql), mirroring the
 * exact metrics/logic shown in-app on apps/web/app/inspect/organisation/insights/page.tsx
 * (Portfolio Insights) so the PDF and the live page never disagree, then follows the same
 * fetch -> template -> Puppeteer PDF -> Storage upload pattern as generateMonthlyReportPack.ts.
 */
export async function renderPortfolioSummaryPdf(
  payload: RenderPortfolioSummaryPdfPayload
): Promise<{ resultStoragePath: string }> {
  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, project_number, name, organization_id")
    .returns<ProjectRow[]>();

  if (projectsError) {
    throw new Error(`Failed to load projects: ${projectsError.message}`);
  }

  const projectRows = projects ?? [];
  const projectIds = projectRows.map((p) => p.id);
  const organizationIds = [...new Set(projectRows.map((p) => p.organization_id))];

  const { data: organizations, error: orgsError } = await supabase
    .from("organizations")
    .select("id, name, engagement_mode, brand_primary_color")
    .returns<OrganizationRow[]>();

  if (orgsError) {
    throw new Error(`Failed to load organizations: ${orgsError.message}`);
  }
  const orgNameById = new Map((organizations ?? []).map((o) => [o.id, o.name]));
  // Same rule as getOrgBranding: a jags_led organisation always uses the JAGS palette, so no swatch.
  const orgBrandColorById = new Map(
    (organizations ?? []).map((o) => [o.id, o.engagement_mode === "jags_led" ? null : o.brand_primary_color] as const)
  );

  const itpsResult =
    projectIds.length > 0
      ? await supabase.from("itps").select("id, project_id, status").in("project_id", projectIds).returns<ItpRow[]>()
      : { data: [] as ItpRow[], error: null };
  if (itpsResult.error) throw new Error(`Failed to load ITPs: ${itpsResult.error.message}`);
  const itps = itpsResult.data ?? [];
  const itpIds = itps.map((i) => i.id);

  const sectionsResult =
    itpIds.length > 0
      ? await supabase.from("itp_sections").select("id, itp_id").in("itp_id", itpIds).returns<ItpSectionRow[]>()
      : { data: [] as ItpSectionRow[], error: null };
  if (sectionsResult.error) throw new Error(`Failed to load ITP sections: ${sectionsResult.error.message}`);
  const sections = sectionsResult.data ?? [];
  const sectionIds = sections.map((s) => s.id);

  const itemsResult =
    sectionIds.length > 0
      ? await supabase.from("itp_items").select("id, section_id, evidence_type").in("section_id", sectionIds).returns<ItpItemRow[]>()
      : { data: [] as ItpItemRow[], error: null };
  if (itemsResult.error) throw new Error(`Failed to load ITP items: ${itemsResult.error.message}`);

  const recordsResult =
    projectIds.length > 0
      ? await supabase
          .from("inspection_records")
          .select("id, project_id, itp_item_id, overall_result, created_at")
          .in("project_id", projectIds)
          .order("created_at", { ascending: true })
          .returns<InspectionRecordRow[]>()
      : { data: [] as InspectionRecordRow[], error: null };
  if (recordsResult.error) throw new Error(`Failed to load inspection records: ${recordsResult.error.message}`);
  const records = recordsResult.data ?? [];

  const ncrsResult =
    projectIds.length > 0
      ? await supabase.from("ncrs").select("id, project_id, status").in("project_id", projectIds).returns<NcrRow[]>()
      : { data: [] as NcrRow[], error: null };
  if (ncrsResult.error) throw new Error(`Failed to load NCRs: ${ncrsResult.error.message}`);
  const ncrs = ncrsResult.data ?? [];
  const openNcrs = ncrs.filter((n) => n.status !== "closed");

  // --- ITP completion %, per project then averaged (matches Portfolio Insights' own logic) ---
  const itpCountsByProject = new Map<string, { total: number; clientAccepted: number }>();
  for (const itp of itps) {
    const entry = itpCountsByProject.get(itp.project_id) ?? { total: 0, clientAccepted: 0 };
    entry.total += 1;
    if (itp.status === "client_accepted") entry.clientAccepted += 1;
    itpCountsByProject.set(itp.project_id, entry);
  }
  const itpRateByProject = new Map<string, number | null>(
    [...itpCountsByProject.entries()].map(([projectId, counts]) => [
      projectId,
      counts.total > 0 ? Math.round((counts.clientAccepted / counts.total) * 1000) / 10 : null,
    ])
  );
  const itpRatesWithData = [...itpRateByProject.values()].filter((r): r is number => r !== null);
  const avgItpCompletionRate = itpRatesWithData.length
    ? itpRatesWithData.reduce((sum, r) => sum + r, 0) / itpRatesWithData.length
    : null;

  // --- First-time pass rate (earliest inspection_record per itp_item, portfolio-wide, all-time) ---
  const firstAttemptByItem = new Map<string, InspectionRecordRow>();
  for (const record of records) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }
  const firstAttempts = [...firstAttemptByItem.values()].filter((r) => r.overall_result !== null);
  const firstTimePasses = firstAttempts.filter((r) => r.overall_result === "pass");
  const firstTimePassRate = firstAttempts.length > 0 ? (firstTimePasses.length / firstAttempts.length) * 100 : null;

  // --- Open NCRs per project ---
  const openNcrsByProject = new Map<string, number>();
  for (const ncr of openNcrs) {
    openNcrsByProject.set(ncr.project_id, (openNcrsByProject.get(ncr.project_id) ?? 0) + 1);
  }

  const perProject: PortfolioSummaryProjectRow[] = projectRows
    .map((project) => ({
      projectId: project.id,
      projectNumber: project.project_number,
      projectName: project.name,
      organizationName: orgNameById.get(project.organization_id) ?? "—",
      organizationBrandColor: orgBrandColorById.get(project.organization_id) ?? null,
      itpCompletionRate: itpRateByProject.get(project.id) ?? null,
      openNcrs: openNcrsByProject.get(project.id) ?? 0,
    }))
    .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));

  const templateData: PortfolioSummaryTemplateData = {
    projectCount: projectRows.length,
    organizationCount: organizationIds.length,
    avgItpCompletionRate,
    openNcrCount: openNcrs.length,
    firstTimePassRate,
    firstTimePassCounts: { firstAttempts: firstAttempts.length, firstTimePasses: firstTimePasses.length },
    perProject,
    generatedAt: new Date(),
  };

  const html = buildPortfolioSummaryHtml(templateData);

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdfBuffer: Buffer;
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
      })
    );
  } finally {
    await page.close();
  }

  // Path keyed by requester + timestamp rather than an organization_id/project_id segment — this
  // report has neither, it's portfolio-wide. See the RLS policy comment in
  // 20260916150000_portfolio_summary_pdf_job.sql for why the storage SELECT policy for this prefix
  // is is_jags_staff()-gated instead of has_org_access()-scoped.
  const pdfPath = `portfolio-summary/${payload.requested_by}/${Date.now()}/report-pack.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(pdfPath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload portfolio summary PDF: ${uploadError.message}`);
  }

  await fileOrgPackInProjectVaults(supabase, {
    projectIds: projectIds,
    title: `Portfolio Summary ${new Date().toISOString().slice(0, 10)}`,
    documentReference: `PORTFOLIO-${new Date().toISOString().slice(0, 10)}`,
    storagePath: pdfPath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
  });

  return { resultStoragePath: pdfPath };
}
