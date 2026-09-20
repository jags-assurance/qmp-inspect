import puppeteer from "puppeteer";
import type { Database } from "@jags/shared-types";
import { supabase } from "../supabase";
import {
  buildItpHtml,
  type ItpTemplateData,
  type ItpTemplateIntervention,
  type ItpTemplateLevelType,
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

  // This ITP's organisation's configured intervention levels (supabase/migrations/
  // 20260917090000_configurable_intervention_levels.sql) — not in the generated Database type yet,
  // same "as any" cast used elsewhere in this file for activity_signoff_progress below.
  const { data: levelTypeRows, error: levelTypesError } = await supabase
    .from("intervention_level_types" as any)
    .select("code, label, sort_order")
    .eq("organization_id", organization.id)
    .returns<{ code: string; label: string; sort_order: number }[]>();

  if (levelTypesError) {
    throw new Error(`Failed to load intervention level types: ${levelTypesError.message}`);
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

  // discipline_id/master_disciplines(name) joined the same way renderInspectionReportPdf.ts joins a
  // single item's discipline — here across every item in the ITP, to derive the document-level
  // discipline (or "Multi-discipline") for the identity line.
  type ItpItemWithDiscipline = Pick<
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
  > & { master_disciplines: { name: string } | null };

  const { data: items, error: itemsError } =
    sectionIds.length > 0
      ? await supabase
          .from("itp_items")
          .select(
            "id, section_id, item_number, activity, reference_spec, acceptance_criteria, method, frequency, evidence_type, sort_order, master_disciplines(name)"
          )
          .in("section_id", sectionIds)
          .order("sort_order", { ascending: true })
          .returns<ItpItemWithDiscipline[]>()
      : { data: [] as ItpItemWithDiscipline[], error: null };

  if (itemsError) {
    throw new Error(`Failed to load ITP items: ${itemsError.message}`);
  }

  const disciplineNames = new Set(
    (items ?? [])
      .map((i) => i.master_disciplines?.name)
      .filter((name): name is string => Boolean(name))
  );
  // Zero items / none set -> null; all agreeing -> that name; spanning more than one -> "Multi-discipline"
  // rather than arbitrarily naming just one of them.
  const discipline = disciplineNames.size === 0 ? null : disciplineNames.size === 1 ? [...disciplineNames][0] : "Multi-discipline";

  // There's no dedicated "source specification document" column on itps in this schema. Only surface
  // a sourceSpec when every item that has a reference_spec agrees on the exact same value — anything
  // less than full agreement is too ambiguous to summarize as a single document reliably, so it's
  // left null (an optional field on ItpTemplateData) rather than guessing.
  const distinctReferenceSpecs = new Set(
    (items ?? [])
      .map((i) => i.reference_spec)
      .filter((spec): spec is string => Boolean(spec && spec.trim()))
  );
  const sourceSpec = distinctReferenceSpecs.size === 1 ? [...distinctReferenceSpecs][0] : null;

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
    { label: "PREPARED", name: itp.prepared_by ? usersById.get(itp.prepared_by) ?? null : null, date: null },
    { label: "REVIEWED", name: itp.reviewed_by ? usersById.get(itp.reviewed_by) ?? null : null, date: null },
    { label: "APPROVED", name: itp.approved_by ? usersById.get(itp.approved_by) ?? null : null, date: null },
    {
      label: "CLIENT ACCEPTED",
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
    discipline,
    sourceSpec,
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
    levelTypes: (levelTypeRows ?? []).map(
      (lt): ItpTemplateLevelType => ({ code: lt.code, label: lt.label, sortOrder: lt.sort_order })
    ),
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
      // mainly governs page *size*, not margin). Bottom margin is taller than the others to leave
      // room for the footerTemplate page-number band below, so it doesn't overlap page content.
      await page.pdf({
        format: "A4",
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "15mm", right: "15mm", bottom: "20mm", left: "15mm" },
        displayHeaderFooter: true,
        // No header markup — the in-HTML letterhead at the top of the first page already serves as
        // the header; a Puppeteer headerTemplate would just duplicate/compete with it.
        headerTemplate: "<div></div>",
        // Puppeteer footer/header templates render in an isolated context with no access to the
        // page's own stylesheet, so styling here has to be inline. pageNumber/totalPages are the two
        // special classes Puppeteer substitutes at render time.
        footerTemplate:
          '<div style="width:100%;font-size:8px;font-family:Arial,Helvetica,sans-serif;color:#666;padding:0 15mm;display:flex;justify-content:space-between;">' +
          "<span>Generated by QMP Inspect &mdash; JAGS Assurance</span>" +
          '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>' +
          "</div>",
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
