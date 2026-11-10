import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import { buildNcrPdfHtml, type NcrPdfData, type NcrPdfSeverity, type NcrPdfStatus } from "./ncrTemplate";
import type { RenderNcrPdfPayload } from "./types";
import { buildNcrApprovalBoxes, loadNcrParties } from "./ncrApprovals";
import { getOrgBranding } from "./orgBranding";
import { buildGeneratedPath, ncrDossierFilingStatus } from "./vaultAutoFile";
import { canFileApproved, findFiledByHash, hashTag, sourceHash, uploadAndFile } from "./generatedDocument";
import { setHtmlContentAndSettle } from "./renderHtml";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface NcrRow {
  id: string;
  ncr_number: string;
  project_id: string;
  severity: NcrPdfSeverity;
  description: string;
  requirement_not_met: string | null;
  status: NcrPdfStatus;
  assigned_to: string | null;
  due_date: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  verification_notes: string | null;
  raised_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
}

/**
 * Fetches everything needed for the branded A4 NCR dossier page (finding + human close-out),
 * renders it via Puppeteer, uploads the result to Storage, and returns the path the caller records
 * on the job row. Mirrors renderInspectionReportPdf.ts's structure exactly, for NCR data instead of
 * inspection-record data.
 */
export async function renderNcrPdf(payload: RenderNcrPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: ncr, error: ncrError } = await supabase
    .from("ncrs" as never)
    .select(
      "id, ncr_number, project_id, severity, description, requirement_not_met, status, assigned_to, due_date, root_cause, corrective_action, preventive_action, verification_notes, raised_by, closed_by, closed_at, created_at"
    )
    .eq("id", payload.ncr_id)
    .single<NcrRow>();

  if (ncrError || !ncr) {
    throw new Error(`NCR ${payload.ncr_id} not found: ${ncrError?.message ?? "no row"}`);
  }

  const [{ data: assignee }, { data: closer }, { data: photoRows }, { data: project }] = await Promise.all([
    ncr.assigned_to
      ? supabase.from("users").select("full_name").eq("id", ncr.assigned_to).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    ncr.closed_by
      ? supabase.from("users").select("full_name").eq("id", ncr.closed_by).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    supabase
      .from("ncr_photos" as never)
      .select("caption, storage_path")
      .eq("ncr_id", ncr.id)
      .returns<{ caption: string | null; storage_path: string }[]>(),
    supabase
      .from("projects")
      .select("organization_id, project_number, name, organizations(name)")
      .eq("id", ncr.project_id)
      .maybeSingle<{
        organization_id: string;
        project_number: string;
        name: string;
        organizations: { name: string } | null;
      }>(),
  ]);

  const parties = await loadNcrParties(supabase, ncr.project_id);
  const raiserUser = ncr.raised_by
    ? (await supabase.from("users").select("full_name").eq("id", ncr.raised_by).maybeSingle<{ full_name: string }>()).data
    : null;
  const approvals = buildNcrApprovalBoxes(
    parties,
    [
      { userId: ncr.raised_by, userName: raiserUser?.full_name ?? null, action: "Raised by", date: ncr.created_at },
      { userId: ncr.assigned_to, userName: assignee?.full_name ?? null, action: "Assigned to", date: null },
      { userId: ncr.closed_by, userName: closer?.full_name ?? null, action: "Closed by", date: ncr.closed_at },
    ].filter((a) => a.userId),
    "JAGS Assurance"
  );

  const photoCaptions = (photoRows ?? []).map((p) => p.caption?.trim()).filter((c): c is string => Boolean(c));
  const photoTotal = (photoRows ?? []).length;
  const evidence =
    photoTotal > 0
      ? `${photoTotal} photo${photoTotal === 1 ? "" : "s"} attached${photoCaptions.length ? `: ${photoCaptions.join("; ")}` : ""}`
      : null;
  const { data: extra } = await supabase
    .from("ncrs" as never)
    .select("root_cause_category, disposition")
    .eq("id", ncr.id)
    .maybeSingle<{ root_cause_category: string | null; disposition: string | null }>();

  const projectName = project ? `${project.project_number} · ${project.name}` : "";

  const templateData: NcrPdfData = {
    ncrNumber: ncr.ncr_number,
    severity: ncr.severity,
    projectName,
    organizationName: project?.organizations?.name ?? null,
    status: ncr.status,
    description: ncr.description,
    requirementNotMet: ncr.requirement_not_met,
    evidence,
    assigneeName: assignee?.full_name ?? null,
    dueDate: ncr.due_date,
    rootCause: ncr.root_cause,
    rootCauseCategory: extra?.root_cause_category ?? null,
    disposition: extra?.disposition ?? null,
    correctiveAction: ncr.corrective_action,
    preventiveAction: ncr.preventive_action,
    verificationNotes: ncr.verification_notes,
    closedByName: closer?.full_name ?? null,
    closedAt: ncr.closed_at,
    generatedAt: new Date(),
    issueDate: ncr.created_at,
    approvals,
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  // Identical dossier already filed: reuse it (open NCRs otherwise pile up one for-review row per click).
  const tag = hashTag(sourceHash({ ...templateData, generatedAt: null }));
  const existing = await findFiledByHash(supabase, ncr.project_id, "approvals_correspondence", ncr.ncr_number, tag);
  if (existing) return { resultStoragePath: existing };

  const html = buildNcrPdfHtml(templateData);

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdfBuffer: Buffer;
  try {
    await setHtmlContentAndSettle(page, withBidi(html));
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
    await page.close();
  }

  const storagePath = buildGeneratedPath(`ncrs/${ncr.id}`, ncr.ncr_number, null, Date.now(), tag);
  // A closed NCR's dossier is a final record, but only staff / close_ncr holders cause an APPROVED copy.
  const filingStatus =
    ncrDossierFilingStatus(ncr.status) === "approved" && (await canFileApproved(supabase, payload.requested_by, ncr.project_id, { permissionKeys: ["close_ncr"] }))
      ? "approved"
      : "for_review";

  // "approvals_correspondence" — no dedicated NCR category exists in the fixed vault taxonomy
  // (lib/vault/types.ts's VAULT_FOLDER_KEYS), and "certificates" is reserved for
  // calibration/qualification-style certificates per
  // 20260917050000_add_test_reports_vault_folder.sql's own header comment, so it would be a poor
  // fit. An NCR dossier is a formal, project-level record of correspondence about a
  // non-conformance, which this category otherwise already covers.
  await uploadAndFile(supabase, storagePath, pdfBuffer, {
    projectId: ncr.project_id,
    folderKey: "approvals_correspondence",
    title: `NCR ${ncr.ncr_number}`,
    documentReference: ncr.ncr_number,
    revision: "0",
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    autoRevision: true,
    // Only a CLOSED NCR is a final record; an open dossier is filed for review and never supersedes
    // an approved copy.
    status: filingStatus,
  });

  return { resultStoragePath: storagePath };
}
