import { getSharedBrowser } from "../browserPool";
import { supabase } from "../supabase";
import { buildIrnPdfHtml, type IrnPdfData } from "./irnTemplate";
import type { IrnApproval } from "./irnTemplate";
import type { RenderIrnPdfPayload } from "./types";
import { autoFileVaultDocument } from "./vaultAutoFile";
import { getOrgBranding } from "./orgBranding";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface IrnRow {
  id: string;
  inspection_record_id: string;
  irn_number: string;
  release_date: string;
  issued_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

interface InspectionRecordRow {
  id: string;
  project_id: string;
  itp_number: string;
  activity: string;
  location: string | null;
  inspection_date: string;
  overall_result: "pass" | "fail" | "partial" | null;
  inspector_id: string | null;
  record_number: string;
  itp_item_id: string | null;
}

/**
 * Fetches everything needed for the branded A4 IRN (Inspection Release Note) certificate — the
 * activity it releases, the inspection record it's based on, the governing ITP, and who signed it
 * off — renders it via Puppeteer, uploads the result to Storage, and returns the path the caller
 * records on the job row. Mirrors renderNcrPdf.ts's structure exactly, for IRN data instead of NCR
 * data.
 */
export async function renderIrnPdf(payload: RenderIrnPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: irn, error: irnError } = await supabase
    .from("irns" as never)
    .select("id, inspection_record_id, irn_number, release_date, issued_by, voided_at, void_reason")
    .eq("id", payload.irn_id)
    .single<IrnRow>();

  if (irnError || !irn) {
    throw new Error(`IRN ${payload.irn_id} not found: ${irnError?.message ?? "no row"}`);
  }

  const { data: record, error: recordError } = await supabase
    .from("inspection_records")
    .select("id, project_id, itp_number, activity, location, inspection_date, overall_result, inspector_id, record_number, itp_item_id")
    .eq("id", irn.inspection_record_id)
    .single<InspectionRecordRow>();

  if (recordError || !record) {
    throw new Error(`Inspection record ${irn.inspection_record_id} not found: ${recordError?.message ?? "no row"}`);
  }

  const [{ data: issuer }, { data: inspector }, { data: project }] = await Promise.all([
    irn.issued_by
      ? supabase.from("users").select("full_name").eq("id", irn.issued_by).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    record.inspector_id
      ? supabase.from("users").select("full_name").eq("id", record.inspector_id).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    supabase
      .from("projects")
      .select("organization_id, project_number, name, organizations(name)")
      .eq("id", record.project_id)
      .maybeSingle<{
        organization_id: string;
        project_number: string;
        name: string;
        organizations: { name: string } | null;
      }>(),
  ]);

  const PARTY_BOXES: { type: string; label: string }[] = [
    { type: "client", label: "CLIENT REPRESENTATIVE" },
    { type: "main_contractor", label: "MAIN CONTRACTOR" },
    { type: "subcontractor", label: "SUBCONTRACTOR" },
    { type: "tpi_lab", label: "TPI / LAB" },
  ];
  const { data: partyRowsRaw } = await supabase
    .from("project_parties")
    .select("id, name, party_type")
    .eq("project_id", record.project_id)
    .returns<{ id: string; name: string; party_type: string }[]>();
  const partyRows = partyRowsRaw ?? [];
  let signoffRows: { project_party_id: string; signed_off_at: string | null; signed_off_by: string | null }[] = [];
  if (record.itp_item_id) {
    const { data } = await supabase
      .from("activity_signoff_progress" as never)
      .select("project_party_id, signed_off_at, signed_off_by")
      .eq("itp_item_id", record.itp_item_id)
      .returns<{ project_party_id: string; signed_off_at: string | null; signed_off_by: string | null }[]>();
    signoffRows = (data ?? []).filter((r) => r.signed_off_at);
  }
  const signerIds = [...new Set(signoffRows.map((r) => r.signed_off_by).filter((x): x is string => Boolean(x)))];
  const signerNames = new Map<string, string>();
  if (signerIds.length) {
    const { data: us } = await supabase.from("users").select("id, full_name").in("id", signerIds).returns<{ id: string; full_name: string }[]>();
    for (const u of us ?? []) signerNames.set(u.id, u.full_name);
  }
  const approvals: IrnApproval[] = [];
  for (const box of PARTY_BOXES) {
    const parties = partyRows.filter((p) => p.party_type === box.type);
    if (parties.length === 0) continue;
    const ids = new Set(parties.map((p) => p.id));
    const so = signoffRows.find((r) => ids.has(r.project_party_id));
    approvals.push({
      label: box.label,
      organisation: parties.map((p) => p.name).join(", "),
      signerName: so?.signed_off_by ? signerNames.get(so.signed_off_by) ?? null : null,
      signatureDataUri: null,
      date: so?.signed_off_at ? so.signed_off_at.slice(0, 10) : null,
    });
  }

  const projectName = project ? `${project.project_number} · ${project.name}` : "";

  const templateData: IrnPdfData = {
    irnNumber: irn.irn_number,
    projectName,
    organizationName: project?.organizations?.name ?? null,
    activity: record.activity,
    itpNumber: record.itp_number,
    inspectionRecordNumber: record.record_number,
    inspectionDate: record.inspection_date,
    location: record.location,
    overallResult: record.overall_result,
    inspectorName: inspector?.full_name ?? null,
    releaseDate: irn.release_date,
    issuedByName: issuer?.full_name ?? null,
    voidedAt: irn.voided_at,
    voidReason: irn.void_reason,
    approvals,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  const html = buildIrnPdfHtml(templateData);

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
        margin: { top: "12mm", right: "15mm", bottom: "18mm", left: "15mm" },
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

  const storagePath = `irns/${irn.id}/${irn.irn_number}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload rendered PDF: ${uploadError.message}`);
  }

  // Filed in the vault like every other generated record; each regeneration becomes the next revision.
  await autoFileVaultDocument(supabase, {
    projectId: record.project_id,
    folderKey: "certificates",
    title: `Inspection Release Note ${irn.irn_number} — ${record.activity}`,
    documentReference: irn.irn_number,
    revision: "0",
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    autoRevision: true,
  });

  return { resultStoragePath: storagePath };
}
