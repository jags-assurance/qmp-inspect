import puppeteer from "puppeteer";
import type { Database } from "@jags/shared-types";
import { supabase } from "../supabase";
import {
  buildItpHtml,
  type ItpTemplateData,
  type ItpTemplateIntervention,
  type ItpTemplateSignoff,
  type ItpTemplateSignoffCell,
  type ItpTemplateSignoffStatus,
} from "./itpTemplate";
import type { RenderItpPdfPayload } from "./types";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

type ItpItemRow = Database["public"]["Tables"]["itp_items"]["Row"];
type InterventionRow = Database["public"]["Tables"]["activity_party_intervention"]["Row"];

/**
 * Fetches everything needed for the ITP document, renders it to landscape A4 PDF via Puppeteer,
 * uploads the result to Storage, and returns the path the caller should record on the job row.
 */
export async function renderItpPdf(payload: RenderItpPdfPayload): Promise<{ resultStoragePath: string }> {
  const { data: itp, error: itpError } = await supabase
    .from("itps")
    .select(
      "id, project_id, itp_number, title, scope, applicable_standard, revision, status, prepared_by, reviewed_by, approved_by, client_accepted_by, client_accepted_at"
    )
    .eq("id", payload.itp_id)
    .single();

  if (itpError || !itp) {
    throw new Error(`ITP ${payload.itp_id} not found: ${itpError?.message ?? "no row"}`);
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id, name, project_number")
    .eq("id", itp.project_id)
    .single();

  if (projectError || !project) {
    throw new Error(`Project ${itp.project_id} not found: ${projectError?.message ?? "no row"}`);
  }

  const { data: organization, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", project.organization_id)
    .single();

  if (orgError || !organization) {
    throw new Error(`Organization ${project.organization_id} not found: ${orgError?.message ?? "no row"}`);
  }

  const { data: parties, error: partiesError } = await supabase
    .from("project_parties")
    .select("id, name, party_type")
    .eq("project_id", project.id)
    .eq("is_active", true);

  if (partiesError) {
    throw new Error(`Failed to load project parties: ${partiesError.message}`);
  }

  const { data: sections, error: sectionsError } = await supabase
    .from("itp_sections")
    .select("id, section_number, title, sort_order")
    .eq("itp_id", itp.id)
    .order("sort_order", { ascending: true });

  if (sectionsError) {
    throw new Error(`Failed to load ITP sections: ${sectionsError.message}`);
  }

  const sectionIds = (sections ?? []).map((s) => s.id);

  const { data: items, error: itemsError } =
    sectionIds.length > 0
      ? await supabase
          .from("itp_items")
          .select("id, section_id, item_number, activity, reference_spec, acceptance_criteria, method, frequency, evidence_type, sort_order")
          .in("section_id", sectionIds)
          .order("sort_order", { ascending: true })
      : { data: [] as Pick<
          ItpItemRow,
          | "id"
          | "section_id"
          | "item_number"
          | "activity"
          | "reference_spec"
          | "acceptance_criteria"
          | "method"
          | "frequency"
          | "evidence_type"
          | "sort_order"
        >[], error: null };

  if (itemsError) {
    throw new Error(`Failed to load ITP items: ${itemsError.message}`);
  }

  const itemIds = (items ?? []).map((i) => i.id);

  const { data: interventionRows, error: interventionError } =
    itemIds.length > 0
      ? await supabase
          .from("activity_party_intervention")
          .select("itp_item_id, project_party_id, intervention")
          .in("itp_item_id", itemIds)
      : { data: [] as Pick<InterventionRow, "itp_item_id" | "project_party_id" | "intervention">[], error: null };

  if (interventionError) {
    throw new Error(`Failed to load intervention grid: ${interventionError.message}`);
  }

  // Not in the generated Database type yet (added by a later migration than the last type
  // generation) — same "as any" escape hatch used elsewhere in this repo for this table, still
  // typed at the call site via .returns<T>().
  const { data: signoffRows, error: signoffError } =
    itemIds.length > 0
      ? await supabase
          .from("activity_signoff_progress" as any)
          .select("itp_item_id, project_party_id, status")
          .in("itp_item_id", itemIds)
          .returns<{ itp_item_id: string; project_party_id: string; status: ItpTemplateSignoffStatus }[]>()
      : { data: [] as { itp_item_id: string; project_party_id: string; status: ItpTemplateSignoffStatus }[], error: null };

  if (signoffError) {
    throw new Error(`Failed to load sign-off progress: ${signoffError.message}`);
  }

  const signoffUserIds = [itp.prepared_by, itp.reviewed_by, itp.approved_by, itp.client_accepted_by].filter(
    (id): id is string => Boolean(id)
  );

  const usersById = new Map<string, string>();
  if (signoffUserIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, full_name")
      .in("id", signoffUserIds);

    if (usersError) {
      throw new Error(`Failed to load signoff users: ${usersError.message}`);
    }

    for (const user of users ?? []) {
      usersById.set(user.id, user.full_name);
    }
  }

  const itemsBySection = new Map<string, typeof items>();
  for (const item of items ?? []) {
    if (!itemsBySection.has(item.section_id)) itemsBySection.set(item.section_id, []);
    itemsBySection.get(item.section_id)!.push(item);
  }

  const interventions: ItpTemplateIntervention[] = (interventionRows ?? []).map((row) => ({
    itpItemId: row.itp_item_id,
    projectPartyId: row.project_party_id,
    code: row.intervention,
  }));

  const signoffStatuses: ItpTemplateSignoffCell[] = (signoffRows ?? []).map((row) => ({
    itpItemId: row.itp_item_id,
    projectPartyId: row.project_party_id,
    status: row.status,
  }));

  const signoffs: ItpTemplateSignoff[] = [
    { label: "Prepared", name: itp.prepared_by ? usersById.get(itp.prepared_by) ?? null : null, date: null },
    { label: "Reviewed", name: itp.reviewed_by ? usersById.get(itp.reviewed_by) ?? null : null, date: null },
    { label: "Approved", name: itp.approved_by ? usersById.get(itp.approved_by) ?? null : null, date: null },
    {
      label: "Client Accepted",
      name: itp.client_accepted_by ? usersById.get(itp.client_accepted_by) ?? null : null,
      date: itp.client_accepted_at,
    },
  ];

  const templateData: ItpTemplateData = {
    itpNumber: itp.itp_number,
    title: itp.title,
    scope: itp.scope,
    applicableStandard: itp.applicable_standard,
    revision: itp.revision,
    status: itp.status,
    organizationName: organization.name,
    projectName: project.name,
    projectNumber: project.project_number,
    parties: (parties ?? []).map((p) => ({ id: p.id, name: p.name, partyType: p.party_type })),
    sections: (sections ?? []).map((section) => ({
      id: section.id,
      sectionNumber: section.section_number,
      title: section.title,
      items: (itemsBySection.get(section.id) ?? []).map((item) => ({
        id: item.id,
        itemNumber: item.item_number,
        activity: item.activity,
        referenceSpec: item.reference_spec,
        acceptanceCriteria: item.acceptance_criteria,
        method: item.method,
        frequency: item.frequency,
        evidenceType: item.evidence_type,
      })),
    })),
    interventions,
    signoffStatuses,
    signoffs,
    generatedAt: new Date(),
  };

  const html = buildItpHtml(templateData);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  let pdfBuffer: Buffer;
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    pdfBuffer = Buffer.from(
      // Explicit margin so it definitely matches this template's `@page { margin: 15mm }` — Chrome's
      // print-to-PDF doesn't reliably fall back to the CSS value on its own (preferCSSPageSize
      // mainly governs page *size*, not margin).
      await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "15mm", left: "15mm" },
      })
    );
  } finally {
    await browser.close();
  }

  const storagePath = `itps/${itp.id}/${itp.itp_number}-rev${itp.revision}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload rendered PDF: ${uploadError.message}`);
  }

  return { resultStoragePath: storagePath };
}
