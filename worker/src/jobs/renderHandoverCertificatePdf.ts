import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import { buildHandoverCertificateHtml, type HandoverCertificatePdfData } from "./handoverCertificateTemplate";
import type { RenderDataBookPdfPayload } from "./types";
import { buildGeneratedPath, resolveNextRevision } from "./vaultAutoFile";
import { findFiledByHash, hashTag, sourceHash, uploadAndFile } from "./generatedDocument";
import { buildVerifyUrl, qrDataUri } from "./verification";
import { getOrgBranding } from "./orgBranding";
import { recordRenderedPdfHash, sealFooterSpan } from "./integritySeal";
import { setHtmlContentAndSettle } from "./renderHtml";

interface CertificateRow {
  id: string;
  certificate_number: string;
  issued_date: string;
  issued_by: string | null;
  package_sha256: string | null;
  is_conditional: boolean | null;
  conditional_reason: string | null;
  conditional_open_items: HandoverCertificatePdfData["conditionalOpenItems"] | null;
  acknowledged_at: string | null;
  received_by_name: string | null;
  received_by_company: string | null;
  acknowledged_on_behalf: boolean | null;
  /** Added by 20261112000101; absent until applied. */
  ack_signature?: string | null;
  ack_evidence_name?: string | null;
  /** Added by 20261101000300; absent until applied. */
  verification_token?: string | null;
}

/**
 * Renders the one-page Handover Certificate for an ISSUED Data Book. Runs as a variant of the
 * "render_data_book_pdf" job (payload.variant === "handover_certificate") so it reuses that job
 * type's existing access rules and the generated-documents "databooks/<id>/" read policy. Refuses
 * anything that is not issued — a certificate only exists once issue_data_book_handover() ran.
 */
export async function renderHandoverCertificatePdf(payload: RenderDataBookPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: book, error: bookError } = await supabase
    .from("data_books")
    .select("id, project_id, book_number, title, status, revision")
    .eq("id", payload.data_book_id)
    .maybeSingle<{ id: string; project_id: string; book_number: string; title: string; status: string; revision: number | string | null }>();
  if (bookError || !book) throw new Error(`Data book ${payload.data_book_id} not found: ${bookError?.message ?? "no row"}`);
  if (book.status !== "issued") throw new Error("A handover certificate only exists for an issued Data Book.");

  const { data: cert, error: certError } = await supabase
    .from("handover_certificates" as never)
    .select("*")
    .eq("data_book_id", book.id)
    .maybeSingle<CertificateRow>();
  if (certError || !cert) throw new Error(`No handover certificate found for data book ${book.id}: ${certError?.message ?? "no row"}`);

  const [{ data: issuer }, { data: project }] = await Promise.all([
    cert.issued_by
      ? supabase.from("users").select("full_name").eq("id", cert.issued_by).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    supabase
      .from("projects")
      .select("organization_id, project_number, name, organizations(name)")
      .eq("id", book.project_id)
      .maybeSingle<{ organization_id: string; project_number: string; name: string; organizations: { name: string } | null }>(),
  ]);

  const revision = await resolveNextRevision(supabase, book.project_id, "certificates", cert.certificate_number);
  const data: HandoverCertificatePdfData = {
    certificateNumber: cert.certificate_number,
    issuedDate: cert.issued_date,
    issuedByName: issuer?.full_name ?? null,
    bookNumber: book.book_number,
    bookTitle: book.title,
    bookRevision: book.revision === null || book.revision === undefined ? null : String(book.revision),
    projectName: project ? `${project.project_number} · ${project.name}` : "",
    organizationName: project?.organizations?.name ?? null,
    packageSha256: cert.package_sha256,
    isConditional: Boolean(cert.is_conditional),
    conditionalReason: cert.conditional_reason,
    conditionalOpenItems: Array.isArray(cert.conditional_open_items) ? cert.conditional_open_items : [],
    acknowledgedAt: cert.acknowledged_at,
    receivedByName: cert.received_by_name,
    receivedByCompany: cert.received_by_company,
    acknowledgedOnBehalf: Boolean(cert.acknowledged_on_behalf),
    acknowledgementSignatureDataUri: cert.ack_signature ?? null,
    acknowledgementEvidenceName: cert.ack_evidence_name ?? null,
    revision,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  // Unchanged certificate (no new acknowledgement, same content) already filed: reuse it instead of filing yet
  // another identical "approved" revision every time someone queues a render.
  const fingerprint = sourceHash({ ...data, generatedAt: null, revision: null });
  const tag = hashTag(fingerprint);
  const existing = await findFiledByHash(supabase, book.project_id, "certificates", cert.certificate_number, tag);
  if (existing) return { resultStoragePath: existing };

  const verifyUrl = buildVerifyUrl("certificate", cert.verification_token);
  data.verifyUrl = verifyUrl;
  data.verifyQrDataUri = await qrDataUri(verifyUrl);

  const html = buildHandoverCertificateHtml(data);
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdf: Buffer;
  try {
    await setHtmlContentAndSettle(page, withBidi(html));
    pdf = Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "12mm", right: "15mm", bottom: "18mm", left: "15mm" },
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: `<div style="width:100%;font-size:7.5px;color:#666;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial,Helvetica,sans-serif;"><span>Generated by QMP Inspect — JAGS Assurance</span>${sealFooterSpan(fingerprint)}<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      })
    );
  } finally {
    await page.close();
  }

  // Under databooks/<data book id>/ so the existing project-scoped storage read policy covers it.
  const storagePath = buildGeneratedPath(`databooks/${book.id}`, `${cert.certificate_number}-handover-certificate`, revision, Date.now(), tag);
  await uploadAndFile(supabase, storagePath, pdf, {
    projectId: book.project_id,
    folderKey: "certificates",
    title: `Handover Certificate ${cert.certificate_number}`,
    documentReference: cert.certificate_number,
    revision,
    storagePath,
    fileSize: pdf.length,
    generatedBy: payload.requested_by,
  });
  // Integrity seal: store the SHA-256 of the exact bytes filed, for the public /verify page.
  await recordRenderedPdfHash(supabase, "certificate", cert.id, pdf);
  return { resultStoragePath: storagePath };
}
