import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import { buildNcrCloseoutPdfHtml, type NcrCloseoutPdfData, type NcrCloseoutSeverity } from "./ncrCloseoutTemplate";
import type { RenderNcrCloseoutCertificatePayload } from "./types";
import { buildNcrApprovalBoxes, loadNcrParties } from "./ncrApprovals";
import { getOrgBranding } from "./orgBranding";
import { buildGeneratedPath, resolveNextRevision, assertNcrCloseoutFileable } from "./vaultAutoFile";
import { canFileApproved, findFiledByHash, hashTag, sourceHash, uploadAndFile } from "./generatedDocument";
import { PermanentJobError } from "./jobAbort";
import { setHtmlContentAndSettle } from "./renderHtml";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface NcrRow {
  id: string;
  ncr_number: string;
  project_id: string;
  severity: NcrCloseoutSeverity;
  description: string;
  status: string;
  responsible_party_id: string | null;
  root_cause: string | null;
  corrective_action: string | null;
  preventive_action: string | null;
  verification_notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  raised_by: string | null;
  created_at: string;
  assigned_to: string | null;
  due_date: string | null;
}

/**
 * Fetches everything needed for the branded A4 NCR close-out certificate (R83) — root cause,
 * corrective/preventive action, verification, responsible party and who closed it — renders it via
 * Puppeteer, uploads the result to Storage, and returns the path the caller records on the job row.
 * Mirrors renderIrnPdf.ts's structure exactly, for NCR close-out data instead of IRN data.
 *
 * Only ever renders a genuinely closed NCR: updateNcrAction (lib/ncrs/actions.ts) is the sole
 * authority boundary that sets status='closed', and only after root_cause/corrective_action/
 * verification_notes are all present, so this refuses to render — rather than render a document that
 * looks certified but isn't — if it somehow gets queued for one that isn't (the request action
 * already checks this too, but the worker is the real authority boundary, same convention as
 * everywhere else in this codebase).
 */
export async function renderNcrCloseoutPdf(payload: RenderNcrCloseoutCertificatePayload): Promise<{ resultStoragePath: string }> {
  const { data: ncr, error: ncrError } = await supabase
    .from("ncrs" as never)
    .select(
      "id, ncr_number, project_id, severity, description, status, responsible_party_id, root_cause, corrective_action, preventive_action, verification_notes, closed_by, closed_at, raised_by, created_at, assigned_to, due_date"
    )
    .eq("id", payload.ncr_id)
    .single<NcrRow>();

  if (ncrError || !ncr) {
    throw new Error(`NCR ${payload.ncr_id} not found: ${ncrError?.message ?? "no row"}`);
  }

  assertNcrCloseoutFileable(ncr);
  if (!ncr.closed_at) {
    throw new PermanentJobError(`NCR ${ncr.id} has no closed_at — refusing to render a close-out certificate.`);
  }

  const [{ data: closer }, { data: responsibleParty }, { data: project }] = await Promise.all([
    ncr.closed_by
      ? supabase.from("users").select("full_name").eq("id", ncr.closed_by).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    ncr.responsible_party_id
      ? supabase
          .from("project_parties")
          .select("name")
          .eq("id", ncr.responsible_party_id)
          .maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
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

  const [{ data: assignee }, { count: photoCount }, { data: docLinks }] = await Promise.all([
    ncr.assigned_to
      ? supabase.from("users").select("full_name").eq("id", ncr.assigned_to).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null }),
    supabase.from("ncr_photos" as never).select("id", { count: "exact", head: true }).eq("ncr_id", ncr.id),
    supabase
      .from("ncr_documents" as never)
      .select("vault_documents(title, document_reference)")
      .eq("ncr_id", ncr.id)
      .returns<{ vault_documents: { title: string; document_reference: string | null } | null }[]>(),
  ]);
  const docRefs = (docLinks ?? []).map((d) => d.vault_documents?.document_reference || d.vault_documents?.title).filter((x): x is string => !!x);
  const evidenceParts: string[] = [];
  if (photoCount) evidenceParts.push(`${photoCount} photo${photoCount === 1 ? "" : "s"}`);
  if (docRefs.length) evidenceParts.push(`documents: ${docRefs.join(", ")}`);
  const evidenceSummary = evidenceParts.length ? evidenceParts.join("; ") : null;

  const parties = await loadNcrParties(supabase, ncr.project_id);
  const raiserUser = ncr.raised_by
    ? (await supabase.from("users").select("full_name").eq("id", ncr.raised_by).maybeSingle<{ full_name: string }>()).data
    : null;
  const approvals = buildNcrApprovalBoxes(
    parties,
    [
      { userId: ncr.raised_by, userName: raiserUser?.full_name ?? null, action: "Raised by", date: ncr.created_at },
      { userId: ncr.closed_by, userName: closer?.full_name ?? null, action: "Closed by", date: ncr.closed_at },
    ].filter((a) => a.userId),
    "JAGS Assurance"
  );

  const projectName = project ? `${project.project_number} · ${project.name}` : "";

  const closeoutRevision = await resolveNextRevision(supabase, ncr.project_id, "certificates", `${ncr.ncr_number}-closeout`);
  const templateData: NcrCloseoutPdfData = {
    ncrNumber: ncr.ncr_number,
    severity: ncr.severity,
    projectName,
    organizationName: project?.organizations?.name ?? null,
    description: ncr.description,
    rootCause: ncr.root_cause,
    correctiveAction: ncr.corrective_action,
    preventiveAction: ncr.preventive_action,
    verificationNotes: ncr.verification_notes,
    responsiblePartyName: responsibleParty?.name ?? null,
    closedByName: closer?.full_name ?? null,
    closedAt: ncr.closed_at,
    assigneeName: assignee?.full_name ?? null,
    dueDate: ncr.due_date,
    raisedAt: ncr.created_at,
    evidenceSummary,
    generatedAt: new Date(),
    revision: closeoutRevision,
    approvals,
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  // Identical close-out already filed (e.g. a second click): return it instead of another identical revision.
  const tag = hashTag(sourceHash({ ...templateData, generatedAt: null, revision: null }));
  const existing = await findFiledByHash(supabase, ncr.project_id, "certificates", `${ncr.ncr_number}-closeout`, tag);
  if (existing) return { resultStoragePath: existing };

  const html = buildNcrCloseoutPdfHtml(templateData);

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

  const storagePath = buildGeneratedPath(`ncr-closeouts/${ncr.id}`, `${ncr.ncr_number}-closeout`, closeoutRevision, Date.now(), tag);
  const approved = await canFileApproved(supabase, payload.requested_by, ncr.project_id, { permissionKeys: ["close_ncr"], allowUserIds: [ncr.closed_by] });

  await uploadAndFile(supabase, storagePath, pdfBuffer, {
    projectId: ncr.project_id,
    folderKey: "certificates",
    title: `NCR ${ncr.ncr_number} — Close-out certificate`,
    documentReference: `${ncr.ncr_number}-closeout`,
    revision: closeoutRevision,
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    status: approved ? "approved" : "for_review",
  });

  return { resultStoragePath: storagePath };
}
