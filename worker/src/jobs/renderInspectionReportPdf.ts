import { getSharedBrowser } from "../browserPool";
import { supabase } from "../supabase";
import {
  buildInspectionReportHtml,
  type InspectionReportData,
  type InspectionReportPhoto,
  type InspectionReportResult,
} from "./inspectionReportTemplate";
import type { RenderInspectionReportPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";
const EVIDENCE_BUCKET = "inspection-evidence";

/** Downloads a photo from the (private) evidence bucket and inlines it as a data: URI, so the
 *  rendered PDF is a self-contained permanent record — never dependent on a signed URL staying
 *  valid after the fact. Best-effort per photo: one bad/missing file is skipped, not fatal. */
async function toDataUri(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(storagePath);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Fetches everything needed for a general Inspection Report (R63-R65, R108), renders it to
 * portrait A4 PDF via Puppeteer, uploads the result to Storage, and returns the path the caller
 * records on the job row. Mirrors renderItpPdf.ts's structure exactly.
 */
export async function renderInspectionReportPdf(
  payload: RenderInspectionReportPdfPayload
): Promise<{ resultStoragePath: string }> {
  const { data: rawRecord, error: recordError } = await supabase
    .from("inspection_records")
    .select(
      "id, record_number, revision, project_id, project_name, itp_number, itp_item_id, activity, location, client_name, applicable_standard, governing_drawing_reference, governing_drawing_revision, inspection_date, overall_result, notes, narrative, inspector_signature, inspector_id"
    )
    .eq("id", payload.inspection_record_id)
    .single();

  const record = rawRecord as {
    id: string;
    record_number: string;
    revision: number | null;
    project_id: string;
    project_name: string;
    itp_number: string;
    itp_item_id: string | null;
    activity: string;
    location: string | null;
    client_name: string | null;
    applicable_standard: string | null;
    governing_drawing_reference: string | null;
    governing_drawing_revision: string | null;
    inspection_date: string | null;
    overall_result: "pass" | "fail" | "partial" | null;
    notes: string | null;
    narrative: string | null;
    inspector_signature: string | null;
    inspector_id: string | null;
  } | null;

  if (recordError || !record) {
    throw new Error(`Inspection record ${payload.inspection_record_id} not found: ${recordError?.message ?? "no row"}`);
  }

  const [{ data: inspector }, { data: itpItem }, { data: responses }, { data: photoRows }, { data: irn }, { data: project }] =
    await Promise.all([
      record.inspector_id
        ? supabase.from("users").select("full_name").eq("id", record.inspector_id).maybeSingle()
        : Promise.resolve({ data: null }),
      record.itp_item_id
        ? supabase
            .from("itp_items")
            .select("discipline_id, reference_spec, master_disciplines(name)")
            .eq("id", record.itp_item_id)
            .maybeSingle<{
              discipline_id: string | null;
              reference_spec: string | null;
              master_disciplines: { name: string } | null;
            }>()
        : Promise.resolve({ data: null }),
      supabase
        .from("checklist_responses")
        .select("result, comment, checklist_items(item_number, description)")
        .eq("inspection_record_id", record.id)
        .returns<
          { result: "yes" | "no" | "na"; comment: string | null; checklist_items: { item_number: string; description: string } | null }[]
        >(),
      supabase
        .from("inspection_photos")
        .select("storage_path, caption")
        .eq("inspection_record_id", record.id)
        .returns<{ storage_path: string; caption: string | null }[]>(),
      supabase.from("irns").select("irn_number").eq("inspection_record_id", record.id).maybeSingle(),
      // organization_id/name for branding (Reqs R113-R118) — record.project_name is a denormalised
      // string, not a join, so the org has to be looked up separately via project_id.
      supabase
        .from("projects")
        .select("organization_id, organizations(name)")
        .eq("id", record.project_id)
        .maybeSingle<{ organization_id: string; organizations: { name: string } | null }>(),
    ]);

  const results: InspectionReportResult[] = (responses ?? [])
    .map((r) => ({
      itemNumber: r.checklist_items?.item_number ?? "",
      description: r.checklist_items?.description ?? "",
      result: r.result,
      comment: r.comment,
    }))
    .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber, undefined, { numeric: true }));

  const photoDataUris = await Promise.all((photoRows ?? []).map((p) => toDataUri(p.storage_path)));
  const photos: InspectionReportPhoto[] = (photoRows ?? [])
    .map((p, i) => ({ caption: p.caption, dataUri: photoDataUris[i] }))
    .filter((p): p is InspectionReportPhoto => Boolean(p.dataUri));

  const templateData: InspectionReportData = {
    recordNumber: record.record_number,
    revision: record.revision ?? 0,
    activity: record.activity,
    projectName: record.project_name,
    organizationName: project?.organizations?.name ?? null,
    itpNumber: record.itp_number,
    location: record.location,
    inspectionDate: record.inspection_date ?? "",
    overallResult: record.overall_result,
    discipline: itpItem?.master_disciplines?.name ?? null,
    notes: record.notes,
    narrative: record.narrative,
    referenceSpec: itpItem?.reference_spec ?? null,
    clientName: record.client_name,
    applicableStandard: record.applicable_standard,
    governingDrawingReference: record.governing_drawing_reference,
    governingDrawingRevision: record.governing_drawing_revision,
    irnNumber: irn?.irn_number ?? null,
    results,
    photos,
    signoffs: [
      { label: "INSPECTOR", name: inspector?.full_name ?? null, date: record.overall_result ? record.inspection_date : null },
      { label: "CONTRACTOR WITNESS", name: null, date: null },
      { label: "CLIENT REPRESENTATIVE", name: null, date: null },
    ],
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  const html = buildInspectionReportHtml(templateData);

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdfBuffer: Buffer;
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Chrome doesn't reliably honor this template's `@page { margin: 15mm }` on its own — must pass
    // it explicitly so it matches the letterhead's -15mm full-bleed trick. See renderItpPdf.ts.
    pdfBuffer = Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "20mm", left: "15mm" },
        displayHeaderFooter: true,
        // Empty header — the in-HTML letterhead already serves as the page header, and Puppeteer's
        // header/footer templates are plain inline-styled HTML with no access to the page's own
        // stylesheet, so there's nothing worth duplicating up here.
        headerTemplate: "<div></div>",
        footerTemplate: `
          <div style="width: 100%; font-size: 8px; font-family: Arial, Helvetica, sans-serif; color: #666; padding: 0 15mm; display: flex; justify-content: space-between;">
            <span>Generated by QMP Inspect &mdash; JAGS Assurance</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      })
    );
  } finally {
    await page.close();
  }

  const storagePath = `inspections/${record.id}/${record.record_number}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload rendered PDF: ${uploadError.message}`);
  }

  return { resultStoragePath: storagePath };
}
