import { getOrgBranding } from "./orgBranding";
import { getSharedBrowser } from "../browserPool";
import { supabase } from "../supabase";
import { autoFileVaultDocument } from "./vaultAutoFile";
import { buildFatReportHtml, type FatReportData, type FatReportPhoto } from "./fatReportTemplate";
import type { RenderFatReportPdfPayload } from "./types";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";
const EVIDENCE_BUCKET = "inspection-evidence";

async function toDataUri(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(storagePath);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

/**
 * Fetches everything for a FAT / Standalone Assignment Report (R14 — the report IS the
 * deliverable for this mode), renders it to portrait A4 PDF, uploads it, and returns the storage
 * path. Mirrors renderInspectionReportPdf.ts's structure; signatures are already data: URL PNGs
 * captured at signing time (standalone_assignment_signatures.signature_data), so unlike photos
 * they need no Storage round-trip.
 */
export async function renderFatReportPdf(payload: RenderFatReportPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: assignment, error: assignmentError } = await supabase
    .from("standalone_assignments" as any)
    .select(
      "id, project_id, assignment_number, assignment_type, equipment_description, manufacturer, model, serial_tag, location, standard_reference, assignment_date, conclusion, notes, narrative, status, cleared_at, cleared_by, clearance_notes, clearance_number"
    )
    .eq("id", payload.assignment_id)
    .single();

  if (assignmentError || !assignment) {
    throw new Error(`Standalone assignment ${payload.assignment_id} not found: ${assignmentError?.message ?? "no row"}`);
  }

  const a = assignment as unknown as {
    id: string;
    project_id: string;
    assignment_number: string;
    assignment_type: string;
    equipment_description: string;
    manufacturer: string | null;
    model: string | null;
    serial_tag: string | null;
    location: string | null;
    standard_reference: string | null;
    assignment_date: string | null;
    conclusion: "pass" | "conditional_pass" | "fail" | null;
    notes: string | null;
    narrative: string | null;
    status: "draft" | "conditional_open" | "completed";
    cleared_at: string | null;
    cleared_by: string | null;
    clearance_notes: string | null;
    clearance_number: string | null;
  };

  let clearedByName: string | null = null;
  if (a.cleared_by) {
    const { data: clearer } = await supabase.from("users").select("full_name").eq("id", a.cleared_by).maybeSingle();
    clearedByName = (clearer as { full_name?: string | null } | null)?.full_name ?? null;
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id, name")
    .eq("id", a.project_id)
    .single();

  if (projectError || !project) {
    throw new Error(`Project ${a.project_id} not found: ${projectError?.message ?? "no row"}`);
  }

  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", project.organization_id)
    .single();

  if (orgError || !organization) {
    throw new Error(`Organization ${project.organization_id} not found: ${orgError?.message ?? "no row"}`);
  }

  const [{ data: measurements }, { data: photoRows }, { data: punchItems }, { data: signatureRows }, { data: linkedPunchRows }] = await Promise.all([
    supabase
      .from("standalone_assignment_measurements" as any)
      .select("description, nominal_value, tolerance, actual_value, unit, result, sort_order")
      .eq("assignment_id", a.id)
      .order("sort_order"),
    supabase
      .from("standalone_assignment_photos" as any)
      .select("storage_path, caption")
      .eq("assignment_id", a.id),
    supabase
      .from("standalone_assignment_punch_items" as any)
      .select("description, status")
      .eq("assignment_id", a.id),
    supabase
      .from("standalone_assignment_signatures" as any)
      .select("role, signatory_name, signature_data, signed_at")
      .eq("assignment_id", a.id)
      .order("signed_at"),
    supabase
      .from("punch_list_items" as any)
      .select("description, status")
      .eq("source_standalone_assignment_id", a.id),
  ]);

  const { data: partyRowsRaw } = await supabase
    .from("project_parties")
    .select("name, party_type")
    .eq("project_id", a.project_id)
    .returns<{ name: string; party_type: string }[]>();

  const photoRowsTyped = (photoRows ?? []) as unknown as { storage_path: string; caption: string | null }[];
  const photoDataUris = await Promise.all(photoRowsTyped.map((p) => toDataUri(p.storage_path)));
  const photos: FatReportPhoto[] = photoRowsTyped
    .map((p, i) => ({ caption: p.caption, dataUri: photoDataUris[i] }))
    .filter((p): p is FatReportPhoto => Boolean(p.dataUri));

  const templateData: FatReportData = {
    assignmentNumber: a.assignment_number,
    assignmentType: a.assignment_type,
    equipmentDescription: a.equipment_description,
    manufacturer: a.manufacturer,
    model: a.model,
    serialTag: a.serial_tag,
    location: a.location,
    standardReference: a.standard_reference,
    assignmentDate: a.assignment_date,
    conclusion: a.conclusion,
    notes: a.notes,
    narrative: a.narrative,
    organizationName: organization.name,
    branding: await getOrgBranding(supabase, project.organization_id),
    projectName: project.name,
    measurements: ((measurements ?? []) as unknown as {
      description: string;
      nominal_value: string | null;
      tolerance: string | null;
      actual_value: string | null;
      unit: string | null;
      result: "pass" | "fail" | null;
    }[]).map((m) => ({
      description: m.description,
      nominalValue: m.nominal_value,
      tolerance: m.tolerance,
      actualValue: m.actual_value,
      unit: m.unit,
      result: m.result,
    })),
    // (result already computed from nominal/tolerance/actual at entry time by addMeasurementAction)
    photos,
    punchItems: [
      ...((punchItems ?? []) as unknown as { description: string; status: "open" | "closed" }[]),
      // Project punch-list items raised by a conditional pass; anything not 'closed' (open, resolved
      // awaiting verification) is still outstanding.
      ...((linkedPunchRows ?? []) as unknown as { description: string; status: string }[]).map((p) => ({
        description: p.description,
        status: (p.status === "closed" ? "closed" : "open") as "open" | "closed",
      })),
    ].map((p) => ({ description: p.description, status: p.status })),
    status: a.status,
    clearance: a.cleared_at
      ? { number: a.clearance_number, notes: a.clearance_notes, clearedAt: a.cleared_at, clearedBy: clearedByName }
      : null,
    signatures: ((signatureRows ?? []) as unknown as {
      role: string;
      signatory_name: string;
      signature_data: string;
      signed_at: string;
    }[]).map((s) => ({
      role: s.role,
      signatoryName: s.signatory_name,
      signatureDataUri: s.signature_data,
      signedAt: s.signed_at,
    })),
    parties: (partyRowsRaw ?? []).map((p) => ({ name: p.name, partyType: p.party_type })),
    generatedAt: new Date(),
  };

  const html = buildFatReportHtml(templateData);

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
        margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
      })
    );
  } finally {
    await page.close();
  }

  const storagePath = `fat-reports/${a.id}/${a.assignment_number}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload rendered PDF: ${uploadError.message}`);
  }

  await autoFileVaultDocument(supabase, {
    projectId: a.project_id,
    folderKey: "test_reports",
    title: `FAT/SAT report ${a.assignment_number} — ${a.equipment_description}`,
    documentReference: a.assignment_number,
    revision: "0",
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    autoRevision: true,
  });

  return { resultStoragePath: storagePath };
}
