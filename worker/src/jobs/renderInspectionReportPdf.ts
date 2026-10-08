import { createPhotoDownscaler, type PhotoDownscaler } from "./photoDownscale";
import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import {
  buildInspectionReportHtml,
  type InspectionReportApproval,
  type InspectionReportData,
  type InspectionReportPhoto,
  type InspectionReportResult,
} from "./inspectionReportTemplate";
import { buildLinkedDocumentRows, type InspectionReportLinkedDocument, type LinkedDocumentSourceRow } from "./linkedDocuments";
import type { RenderInspectionReportPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";
import { buildGeneratedPath, resolveNextRevision, assertInspectionFileable } from "./vaultAutoFile";
import { canFileApproved, findFiledByHash, hashTag, sourceHash, uploadAndFile } from "./generatedDocument";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";
const EVIDENCE_BUCKET = "inspection-evidence";

/** Downloads a photo from the (private) evidence bucket and inlines it as a data: URI, so the
 *  rendered PDF is a self-contained permanent record — never dependent on a signed URL staying
 *  valid after the fact. Best-effort per photo: one bad/missing file is skipped, not fatal. */
// An inline base64 photo is ~1.33x its size and the whole report is ONE html string in a shared browser:
// 80 photos at 5 MB would be a 500 MB+ document that times out or takes the queue down. Cap per photo, per
// report and in count; whatever is left out is LISTED in the report instead of silently dropped.
// The cap applies to the ORIGINAL download; photos are downscaled (S6-07, photoDownscale.ts) before they are
// inlined, so originals can be larger than what the report actually carries, and the total cap below is
// counted on the downscaled bytes that really go into the document.
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 48 * 1024 * 1024;
const MAX_PHOTOS = 60;

type PhotoOutcome = { dataUri: string; bytes: number } | { skipped: string };

async function toDataUri(storagePath: string, downscaler: PhotoDownscaler): Promise<PhotoOutcome> {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(storagePath);
  if (error || !data) return { skipped: "could not be read" };
  if (data.size > MAX_PHOTO_BYTES) return { skipped: `larger than ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB` };
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  const scaled = await downscaler.downscale(buffer, contentType);
  return { dataUri: scaled.dataUri, bytes: scaled.bytes };
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

  // Documents linked to individual checklist items. Best-effort: a failed read leaves the section out
  // rather than failing the whole report.
  let linkedDocuments: InspectionReportLinkedDocument[] = [];
  {
    const { data: rawDocRows, error: docErr } = await supabase
      .from("inspection_evidence_documents" as never)
      .select("vault_document_id, checklist_item_id, vault_documents(title, document_reference, status)")
      .eq("inspection_record_id" as never, record.id as never)
      .not("checklist_item_id" as never, "is", null);
    const docRows = rawDocRows as unknown as LinkedDocumentSourceRow[] | null;
    if (docErr) {
      console.error("[inspection-report] linked documents unavailable", docErr.message);
    } else if (docRows && docRows.length > 0) {
      const itemIds = uniq(docRows.map((d) => d.checklist_item_id));
      const { data: itemRows } = await supabase.from("checklist_items").select("id, item_number").in("id", itemIds);
      const itemNumberById = new Map(((itemRows ?? []) as { id: string; item_number: string }[]).map((i) => [i.id, i.item_number]));
      linkedDocuments = buildLinkedDocumentRows(docRows, itemNumberById, record.project_id, process.env.PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL);
    }
  }

  const photos: InspectionReportPhoto[] = [];
  const skippedPhotos: string[] = [];
  let totalPhotoBytes = 0;
  // Sequential in small batches so memory stays bounded (the old code downloaded every photo at once).
  const allPhotos = photoRows ?? [];
  const downscaler = createPhotoDownscaler();
  try {
  for (let i = 0; i < allPhotos.length; i += 4) {
    const batch = allPhotos.slice(i, i + 4);
    const outcomes = await Promise.all(
      batch.map((p, j) => (i + j >= MAX_PHOTOS ? Promise.resolve<PhotoOutcome>({ skipped: `over the ${MAX_PHOTOS}-photo limit` }) : toDataUri(p.storage_path, downscaler)))
    );
    outcomes.forEach((o, j) => {
      const p = batch[j];
      const label = p.caption?.trim() ? p.caption.trim() : p.storage_path.split("/").pop() ?? "photo";
      if ("skipped" in o) skippedPhotos.push(`${label} (${o.skipped})`);
      else if (totalPhotoBytes + o.bytes > MAX_TOTAL_PHOTO_BYTES) skippedPhotos.push(`${label} (report photo size limit reached)`);
      else {
        totalPhotoBytes += o.bytes;
        photos.push({ caption: p.caption, dataUri: o.dataUri });
      }
    });
  }
  } finally {
    await downscaler.close();
  }

  // Only a completed inspection (overall result recorded) is a final report.
  assertInspectionFileable(record.overall_result);
  // The printed REV is the vault revision this render will be filed as.
  const revision = await resolveNextRevision(supabase, record.project_id, "checklists_forms", record.record_number);

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
    linkedDocuments,
    photos,
    skippedPhotos,
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

  // Identical source content already filed? Return that file instead of minting another identical revision.
  const fingerprint = sourceHash({ ...templateData, generatedAt: null, revision: null });
  const tag = hashTag(fingerprint);
  const existing = await findFiledByHash(supabase, record.project_id, "checklists_forms", record.record_number, tag);
  if (existing) return { resultStoragePath: existing };

  const html = buildInspectionReportHtml(templateData);

  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  let pdfBuffer: Buffer;
  try {
    await page.setContent(withBidi(html), { waitUntil: "networkidle0" });
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

  const storagePath = buildGeneratedPath(`inspections/${record.id}`, record.record_number, revision, Date.now(), tag);
  // Only staff / approvers cause an APPROVED copy; anyone else's render is filed for review.
  const approved = await canFileApproved(supabase, payload.requested_by, record.project_id);

  // "checklists_forms" — an Inspection Report is the rendered output of a completed checklist
  // execution, which this category already covers; there is no separate "inspection reports"
  // category in the fixed vault taxonomy.
  await uploadAndFile(supabase, storagePath, pdfBuffer, {
    projectId: record.project_id,
    folderKey: "checklists_forms",
    title: `Inspection Report ${record.record_number} — ${record.activity}`,
    documentReference: record.record_number,
    revision,
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    status: approved ? "approved" : "for_review",
  });

  return { resultStoragePath: storagePath };
}
