import puppeteer from "puppeteer";
import { supabase } from "../supabase";
import {
  buildInspectionReportHtml,
  type InspectionReportData,
  type InspectionReportPhoto,
  type InspectionReportResult,
} from "./inspectionReportTemplate";
import type { RenderInspectionReportPdfPayload } from "./types";

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
  const { data: record, error: recordError } = await supabase
    .from("inspection_records")
    .select(
      "id, record_number, project_id, project_name, itp_number, itp_item_id, activity, location, inspection_date, overall_result, notes, narrative, inspector_signature, inspector_id"
    )
    .eq("id", payload.inspection_record_id)
    .single();

  if (recordError || !record) {
    throw new Error(`Inspection record ${payload.inspection_record_id} not found: ${recordError?.message ?? "no row"}`);
  }

  const [{ data: inspector }, { data: itpItem }, { data: responses }, { data: photoRows }] = await Promise.all([
    record.inspector_id
      ? supabase.from("users").select("full_name").eq("id", record.inspector_id).maybeSingle()
      : Promise.resolve({ data: null }),
    record.itp_item_id
      ? supabase
          .from("itp_items")
          .select("discipline_id, master_disciplines(name)")
          .eq("id", record.itp_item_id)
          .maybeSingle<{ discipline_id: string | null; master_disciplines: { name: string } | null }>()
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
    activity: record.activity,
    projectName: record.project_name,
    itpNumber: record.itp_number,
    location: record.location,
    inspectionDate: record.inspection_date,
    overallResult: record.overall_result,
    discipline: itpItem?.master_disciplines?.name ?? null,
    notes: record.notes,
    narrative: record.narrative,
    results,
    photos,
    signoffs: [
      { label: "INSPECTOR", name: inspector?.full_name ?? null, date: record.overall_result ? record.inspection_date : null },
      { label: "CONTRACTOR WITNESS", name: null, date: null },
      { label: "CLIENT REPRESENTATIVE", name: null, date: null },
    ],
    generatedAt: new Date(),
  };

  const html = buildInspectionReportHtml(templateData);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Chrome doesn't reliably honor this template's `@page { margin: 15mm }` on its own — must pass
    // it explicitly so it matches the letterhead's -15mm full-bleed trick. See renderItpPdf.ts.
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
    await browser.close();
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
