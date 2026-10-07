import { getSharedBrowser } from "../browserPool";
import { supabase } from "../supabase";
import {
  buildInspectionReportHtml,
  type InspectionReportApproval,
  type InspectionReportData,
  type InspectionReportPhoto,
  type InspectionReportResult,
} from "./inspectionReportTemplate";
import type { RenderInspectionReportPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";
import { autoFileVaultDocument } from "./vaultAutoFile";

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
      "id, record_number, revision, project_id, project_name, itp_number, itp_item_id, activity, location, client_name, applicable_standard, governing_drawing_reference, governing_drawing_revision, inspection_date, overall_result, notes, narrative, inspector_signature, inspector_id, signed_by_name, signed_at, witness_name, witness_signature"
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
    signed_by_name: string | null;
    signed_at: string | null;
    witness_name: string | null;
    witness_signature: string | null;
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
        .select("result, comment, calibration_asset_id, material_id, welder_id, checklist_items(item_number, description)")
        .eq("inspection_record_id", record.id)
        .returns<
          { result: "yes" | "no" | "na"; comment: string | null; calibration_asset_id: string | null; material_id: string | null; welder_id: string | null; checklist_items: { item_number: string; description: string } | null }[]
        >(),
      supabase
        .from("inspection_photos")
        .select("storage_path, caption")
        .eq("inspection_record_id", record.id)
        .returns<{ storage_path: string; caption: string | null }[]>(),
      supabase
        .from("irns")
        .select("irn_number")
        .eq("inspection_record_id", record.id)
        .is("voided_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
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

  const uniq = (ids: (string | null)[]) => [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const calIds = uniq((responses ?? []).map((r) => r.calibration_asset_id));
  const matIds = uniq((responses ?? []).map((r) => r.material_id));
  const welIds = uniq((responses ?? []).map((r) => r.welder_id));
  const [calRes, matRes, welRes] = await Promise.all([
    calIds.length
      ? supabase.from("calibration_register").select("instrument_name, instrument_tag, cert_number, due_date").in("id", calIds)
      : Promise.resolve({ data: [] }),
    matIds.length
      ? supabase.from("material_register").select("material_description, heat_number, batch_number, certificate_reference").in("id", matIds)
      : Promise.resolve({ data: [] }),
    welIds.length
      ? supabase.from("welder_qualification_register").select("welder_identifier, wpq_number, expiry_date").in("id", welIds)
      : Promise.resolve({ data: [] }),
  ]);
  const instruments = ((calRes.data ?? []) as unknown as { instrument_name: string; instrument_tag: string | null; cert_number: string | null; due_date: string | null }[]).map((c) => ({
    name: c.instrument_name, tag: c.instrument_tag, cert: c.cert_number, due: c.due_date,
  }));
  const materials = ((matRes.data ?? []) as unknown as { material_description: string; heat_number: string | null; batch_number: string | null; certificate_reference: string | null }[]).map((m) => ({
    description: m.material_description, heat: m.heat_number, batch: m.batch_number, cert: m.certificate_reference,
  }));
  const welders = ((welRes.data ?? []) as unknown as { welder_identifier: string; wpq_number: string | null; expiry_date: string | null }[]).map((w) => ({
    id: w.welder_identifier, wpq: w.wpq_number, expiry: w.expiry_date,
  }));

  const photoDataUris = await Promise.all((photoRows ?? []).map((p) => toDataUri(p.storage_path)));
  const photos: InspectionReportPhoto[] = (photoRows ?? [])
    .map((p, i) => ({ caption: p.caption, dataUri: photoDataUris[i] }))
    .filter((p): p is InspectionReportPhoto => Boolean(p.dataUri));

  // Revision: number of re-open/amend events (0 = original). Falls back to the stored column.
  const { count: amendCount } = await (supabase as unknown as { from: (t: string) => any })
    .from("inspection_record_amendments")
    .select("id", { count: "exact", head: true })
    .eq("record_id", record.id);
  const revision = typeof amendCount === "number" ? amendCount : record.revision ?? 0;

  // Approvals: one box per party type present on the project, plus the JAGS inspector.
  const { data: partyRows } = await supabase
    .from("project_parties")
    .select("id, party_type, name")
    .eq("project_id", record.project_id)
    .eq("is_active", true)
    .returns<{ id: string; party_type: string; name: string }[]>();
  const parties = partyRows ?? [];
  const signoffRows = record.itp_item_id
    ? ((
        await supabase
          .from("activity_signoff_progress")
          .select("project_party_id, signed_off_at, signed_off_by, status")
          .eq("itp_item_id", record.itp_item_id)
          .eq("status", "signed_off")
      ).data ?? []) as { project_party_id: string; signed_off_at: string | null; signed_off_by: string | null }[]
    : [];
  const signerIds = [...new Set(signoffRows.map((s) => s.signed_off_by).filter((x): x is string => Boolean(x)))];
  const signerNames = new Map<string, string>();
  if (signerIds.length) {
    const { data: us } = await supabase.from("users").select("id, full_name").in("id", signerIds);
    for (const u of (us ?? []) as { id: string; full_name: string | null }[]) if (u.full_name) signerNames.set(u.id, u.full_name);
  }
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : null);
  const validSig = (s: string | null): string | null =>
    s && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
  const PARTY_BOXES: [string, string][] = [
    ["client", "CLIENT REPRESENTATIVE"],
    ["main_contractor", "MAIN CONTRACTOR"],
    ["subcontractor", "SUBCONTRACTOR"],
    ["tpi_lab", "TPI / LAB"],
  ];
  const approvals: InspectionReportApproval[] = [
    {
      label: "JAGS INSPECTOR",
      org: "JAGS Assurance",
      name: record.signed_by_name || inspector?.full_name || null,
      signature: validSig(record.inspector_signature),
      date: record.signed_at ? fmtDate(record.signed_at) : record.overall_result ? record.inspection_date : null,
    },
  ];
  let witnessUsed = false;
  for (const [type, label] of PARTY_BOXES) {
    const party = parties.find((p) => p.party_type === type);
    if (!party) continue;
    const so = signoffRows.find((s) => s.project_party_id === party.id);
    let name = so?.signed_off_by ? signerNames.get(so.signed_off_by) ?? null : null;
    let signature: string | null = null;
    let date = fmtDate(so?.signed_off_at ?? null);
    if (!so && !witnessUsed && (record.witness_name || record.witness_signature) && (type === "client" || (type === "tpi_lab" && !parties.some((p) => p.party_type === "client")))) {
      name = record.witness_name;
      signature = validSig(record.witness_signature);
      date = record.signed_at ? fmtDate(record.signed_at) : null;
      witnessUsed = true;
    }
    approvals.push({ label, org: party.name, name, signature, date });
  }

  const templateData: InspectionReportData = {
    recordNumber: record.record_number,
    revision,
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
    signedByName: record.signed_by_name,
    signedAt: record.signed_at ? new Date(record.signed_at) : null,
    witnessName: record.witness_name,
    witnessSignature: record.witness_signature,
    instruments,
    materials,
    welders,
    inspectorName: record.signed_by_name || inspector?.full_name || null,
    approvals,
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

  // "checklists_forms" — an Inspection Report is the rendered output of a completed checklist
  // execution, which this category already covers; there is no separate "inspection reports"
  // category in the fixed vault taxonomy.
  await autoFileVaultDocument(supabase, {
    projectId: record.project_id,
    folderKey: "checklists_forms",
    title: `Inspection Report ${record.record_number} — ${record.activity}`,
    documentReference: record.record_number,
    revision: String(record.revision ?? 0),
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    autoRevision: true,
  });

  return { resultStoragePath: storagePath };
}
