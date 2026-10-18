import { resolveInspectionFilingContext } from "./vaultFilingContext";
import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import { buildIrnPdfHtml, type IrnPdfData } from "./irnTemplate";
import type { IrnApproval } from "./irnTemplate";
import type { RenderIrnPdfPayload } from "./types";
import { uploadGeneratedFile, buildGeneratedPath, resolveNextRevision, assertIrnFileable } from "./vaultAutoFile";
import { canFileApproved, findFiledByHash, hashTag, sourceHash, uploadAndFile } from "./generatedDocument";
import { buildVerifyUrl, qrDataUri } from "./verification";
import { getOrgBranding } from "./orgBranding";
import { recordRenderedPdfHash, sealFooterSpan } from "./integritySeal";
import { setHtmlContentAndSettle } from "./renderHtml";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface IrnRow {
  id: string;
  inspection_record_id: string;
  irn_number: string;
  release_date: string;
  issued_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  /** Added by 20261101000300; absent until applied. */
  verification_token?: string | null;
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
  inspector_signature: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
  witness_name: string | null;
  witness_signature: string | null;
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
    .select("*")
    .eq("id", payload.irn_id)
    .single<IrnRow>();

  if (irnError || !irn) {
    throw new Error(`IRN ${payload.irn_id} not found: ${irnError?.message ?? "no row"}`);
  }

  // A voided IRN is rendered as a VOID copy (banner + watermark) for the requester; it is never filed in the
  // vault as a current document (the void flow already marked the filed copy superseded).
  assertIrnFileable(irn.voided_at, true);
  const isVoidCopy = Boolean(irn.voided_at);

  const { data: record, error: recordError } = await supabase
    .from("inspection_records")
    .select("id, project_id, itp_number, activity, location, inspection_date, overall_result, inspector_id, record_number, itp_item_id, inspector_signature, signed_by_name, signed_at, witness_name, witness_signature")
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
      .order("signed_off_at", { ascending: false })
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
    // signoffRows are ordered latest first, so find() picks the most recent sign-off deterministically.
    const so = signoffRows.find((r) => ids.has(r.project_party_id));
    approvals.push({
      label: box.label,
      organisation: parties.map((p) => p.name).join(", "),
      signerName: so?.signed_off_by ? signerNames.get(so.signed_off_by) ?? null : null,
      signatureDataUri: null,
      date: so?.signed_off_at ? so.signed_off_at.slice(0, 10) : null,
    });
  }

  const validSig = (s: string | null): string | null =>
    s && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
  const revision = await resolveNextRevision(supabase, record.project_id, "certificates", irn.irn_number);
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
    inspectorName: record.signed_by_name || inspector?.full_name || null,
    inspectorSignatureDataUri: validSig(record.inspector_signature),
    inspectorSignedAt: record.signed_at,
    witnessName: record.witness_name,
    witnessSignatureDataUri: validSig(record.witness_signature),
    revision,
    releaseDate: irn.release_date,
    issuedByName: issuer?.full_name ?? null,
    voidedAt: irn.voided_at,
    voidReason: irn.void_reason,
    approvals,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  // Same source content as an already-filed copy: return that file instead of minting an identical new
  // controlled revision on every click (live IRNs only).
  const fingerprint = sourceHash({ ...templateData, generatedAt: null, revision: null });
  const tag = hashTag(fingerprint);
  if (!isVoidCopy) {
    const existing = await findFiledByHash(supabase, record.project_id, "certificates", irn.irn_number, tag);
    if (existing) return { resultStoragePath: existing };
  }

  const verifyUrl = buildVerifyUrl("irn", irn.verification_token);
  templateData.verifyUrl = verifyUrl;
  templateData.verifyQrDataUri = await qrDataUri(verifyUrl);

  const html = buildIrnPdfHtml(templateData);

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
        margin: { top: "12mm", right: "15mm", bottom: "18mm", left: "15mm" },
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: `
          <div style="width:100%;font-size:7.5px;color:#666;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial,Helvetica,sans-serif;">
            <span>Generated by QMP Inspect — JAGS Assurance</span>
            ${sealFooterSpan(fingerprint)}
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      })
    );
  } finally {
    await page.close();
  }

  const storagePath = buildGeneratedPath(`irns/${irn.id}`, isVoidCopy ? `${irn.irn_number}-VOID` : irn.irn_number, revision, Date.now(), tag);

  if (isVoidCopy) {
    await uploadGeneratedFile(supabase, storagePath, pdfBuffer);
    await recordRenderedPdfHash(supabase, "irn", irn.id, pdfBuffer);
    return { resultStoragePath: storagePath };
  }

  // Only staff, the issuer or an issue_irn holder cause an APPROVED copy; anyone else's render is filed for review.
  const approved = await canFileApproved(supabase, payload.requested_by, record.project_id, { permissionKeys: ["issue_irn"], allowUserIds: [irn.issued_by] });

  // Filed in the vault like every other generated record; a changed IRN becomes the next revision. If filing
  // fails the uploaded object is removed again so a retry does not orphan it.
  const filing = await resolveInspectionFilingContext(supabase, record);
  await uploadAndFile(supabase, storagePath, pdfBuffer, {
    projectId: record.project_id,
    folderKey: "certificates",
    filingPath: filing.filingPath,
    title: `Inspection Release Note ${irn.irn_number} — ${record.activity}`,
    documentReference: irn.irn_number,
    revision,
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    status: approved ? "approved" : "for_review",
  });

  await recordRenderedPdfHash(supabase, "irn", irn.id, pdfBuffer);
  return { resultStoragePath: storagePath };
}
