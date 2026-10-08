import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import { buildAuditTrailPdfHtml, type AuditTrailPdfRow } from "./auditTrailTemplate";
import type { RenderAuditTrailPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";
import { buildGeneratedPath, uploadGeneratedFile } from "./vaultAutoFile";
import { PermanentJobError } from "./jobAbort";
import { setHtmlContentAndSettle } from "./renderHtml";

/** Rows a single PDF will list. Beyond this the PDF says so on its first page; the CSV export has no cap. */
export const AUDIT_PDF_ROW_CAP = 5000;
const PAGE = 1000;

interface AuditRow {
  created_at: string;
  entity_type: string;
  action: string;
  summary: string;
  actor: { full_name: string | null; email: string | null } | null;
}

/**
 * Renders a project's audit log (with the web page's filters) to a landscape A4 PDF and uploads it under
 * audit-trails/{project_id}/ in the generated-documents bucket. Staff-only: the worker (service role)
 * re-checks that the requester is JAGS staff, since the queue row alone is not an authority boundary.
 * Deliberately NOT filed into the project vault - an export of the trail is a point-in-time copy, not a
 * controlled document, and it must not be able to supersede one.
 */
export async function renderAuditTrailPdf(payload: RenderAuditTrailPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: requester, error: reqError } = await supabase
    .from("users")
    .select("full_name, is_jags_staff")
    .eq("id", payload.requested_by)
    .maybeSingle<{ full_name: string | null; is_jags_staff: boolean | null }>();
  if (reqError) throw new Error(`Could not verify requester ${payload.requested_by}: ${reqError.message}`);
  if (requester?.is_jags_staff !== true) {
    throw new PermanentJobError("The audit trail can only be exported by JAGS staff.");
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("organization_id, project_number, name, organizations(name)")
    .eq("id", payload.project_id)
    .maybeSingle<{ organization_id: string; project_number: string; name: string; organizations: { name: string } | null }>();
  if (projectError || !project) {
    throw new Error(`Project ${payload.project_id} not found: ${projectError?.message ?? "no row"}`);
  }

  // Page newest-first up to the cap plus one probe row, so truncation is detected rather than guessed.
  const rows: AuditRow[] = [];
  for (let from = 0; rows.length <= AUDIT_PDF_ROW_CAP; from += PAGE) {
    let query = supabase
      .from("audit_log" as never)
      .select("created_at, entity_type, action, summary, actor:users(full_name, email)")
      .eq("project_id", payload.project_id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (payload.from_iso) query = query.gte("created_at", payload.from_iso);
    if (payload.cat) query = query.eq("entity_type", payload.cat);
    if (payload.actor) query = query.eq("actor_id", payload.actor);
    const { data, error } = await query.returns<AuditRow[]>();
    if (error) throw new Error(`Could not read the audit log: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  const truncated = rows.length > AUDIT_PDF_ROW_CAP;
  const listed = truncated ? rows.slice(0, AUDIT_PDF_ROW_CAP) : rows;

  let actorName: string | null = null;
  if (payload.actor) {
    const { data: a } = await supabase.from("users").select("full_name").eq("id", payload.actor).maybeSingle<{ full_name: string | null }>();
    actorName = a?.full_name ?? null;
  }
  const filterParts = [payload.from_iso ? `events since ${payload.from_iso.slice(0, 10)}` : "all recorded events"];
  if (payload.cat) filterParts.push(`category: ${payload.cat}`);
  if (payload.actor) filterParts.push(`person: ${actorName || payload.actor}`);

  const pdfRows: AuditTrailPdfRow[] = listed.map((r) => ({
    createdAt: r.created_at,
    actorName: r.actor?.full_name ?? null,
    actorEmail: r.actor?.email ?? null,
    entityType: r.entity_type,
    action: r.action,
    summary: r.summary,
  }));

  const html = buildAuditTrailPdfHtml({
    projectName: `${project.project_number} · ${project.name}`,
    organizationName: project.organizations?.name ?? null,
    filterDescription: filterParts.join("; "),
    rows: pdfRows,
    truncated,
    rowCap: AUDIT_PDF_ROW_CAP,
    exportedByName: requester.full_name,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project.organization_id),
  });

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdfBuffer: Buffer;
  try {
    await setHtmlContentAndSettle(page, withBidi(html));
    pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: true,
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

  const storagePath = buildGeneratedPath(`audit-trails/${payload.project_id}`, `audit-trail-${project.project_number}`, null);
  await uploadGeneratedFile(supabase, storagePath, pdfBuffer);
  return { resultStoragePath: storagePath };
}
