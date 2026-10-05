import { getSharedBrowser } from "../browserPool";
import { supabase } from "../supabase";
import {
  buildDataBookPdfHtml,
  dataBookIssueLabel,
  type DataBookPdfActivity,
  type DataBookPdfCategory,
  type DataBookPdfData,
  type DataBookPdfDisciplineRow,
  type DataBookPdfItp,
  type DataBookRecordState,
} from "./dataBookTemplate";
import type { RenderDataBookPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";
import { autoFileVaultDocument } from "./vaultAutoFile";

const GENERATED_DOCUMENTS_BUCKET = "generated-documents";

interface DataBookRow {
  id: string;
  project_id: string;
  book_number: string;
  title: string;
  status: "draft" | "compiled" | "issued";
  compiled_at: string | null;
  compiled_by: string | null;
  override_reason: string | null;
  override_by: string | null;
}

function toCategory(label: string, ready: number, total: number): DataBookPdfCategory {
  return { label, ready, total, percentage: total === 0 ? 100 : Math.round((ready / total) * 100) };
}

/**
 * Re-derives apps/web/lib/databook/readiness.ts's computeDataBookReadiness for this worker process.
 * Not a straight import: that module goes through createSupabaseServerClient() (Next.js
 * cookie-bound, server-only) which the worker has no access to — the worker only ever holds a
 * service-role Supabase client (../supabase). Every category, formula, and gating rule below is
 * kept identical to readiness.ts on purpose; if that file's categories or thresholds ever change,
 * this needs the same change made here.
 */
async function computeDataBookReadinessForWorker(projectId: string): Promise<{
  categories: DataBookPdfCategory[];
  handoverCertificate: DataBookPdfCategory;
  openPunchItems: number;
  overallPercentage: number;
  isReady: boolean;
}> {
  const [
    { data: itps },
    { data: inspectionRecords },
    { data: ncrs },
    { count: openPunchItems },
    { data: calibrationRows },
    { data: welderRows },
    { data: materialRows },
    { data: issuedDataBooks },
  ] = await Promise.all([
    supabase.from("itps").select("id, status").eq("project_id", projectId).returns<{ id: string; status: string }[]>(),
    supabase
      .from("inspection_records")
      .select("id, checklist_template_id, overall_result, irns(id)")
      .eq("project_id", projectId)
      .returns<
        {
          id: string;
          checklist_template_id: string | null;
          overall_result: string | null;
          irns: { id: string }[] | { id: string } | null;
        }[]
      >(),
    supabase.from("ncrs" as never).select("id, status").eq("project_id", projectId).neq("severity", "observation").returns<{ id: string; status: string }[]>(),
    supabase
      .from("punch_list_items" as never)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "open"),
    supabase
      .from("calibration_register" as never)
      .select("id, status")
      .eq("project_id", projectId)
      .returns<{ id: string; status: string }[]>(),
    supabase
      .from("welder_qualification_register" as never)
      .select("id, status")
      .eq("project_id", projectId)
      .returns<{ id: string; status: string }[]>(),
    supabase
      .from("material_register" as never)
      .select("id, approval_status, receipt_status")
      .eq("project_id", projectId)
      .returns<{ id: string; approval_status: string; receipt_status: string }[]>(),
    supabase.from("data_books" as never).select("id").eq("project_id", projectId).eq("status", "issued").returns<{ id: string }[]>(),
  ]);

  const itpTotal = itps?.length ?? 0;
  const itpReady = (itps ?? []).filter((itp) => itp.status === "approved" || itp.status === "client_accepted").length;

  const recordTotal = inspectionRecords?.length ?? 0;
  const recordReady = (inspectionRecords ?? []).filter((record) =>
    Array.isArray(record.irns) ? record.irns.length > 0 : record.irns !== null
  ).length;

  const { data: itpIdsForProject } = await supabase.from("itps").select("id").eq("project_id", projectId);
  const itpIds = (itpIdsForProject ?? []).map((i: { id: string }) => i.id);
  let checklistTotal = 0;
  let checklistReady = 0;
  if (itpIds.length > 0) {
    const { data: sections } = await supabase.from("itp_sections").select("id").in("itp_id", itpIds);
    const sectionIds = (sections ?? []).map((s: { id: string }) => s.id);
    if (sectionIds.length > 0) {
      const { data: items } = await supabase.from("itp_items").select("id").in("section_id", sectionIds).eq("evidence_type", 1);
      const itemIds = (items ?? []).map((i: { id: string }) => i.id);
      if (itemIds.length > 0) {
        const { data: templates } = await supabase
          .from("checklist_templates" as never)
          .select("id")
          .in("itp_item_id", itemIds)
          .returns<{ id: string }[]>();
        checklistTotal = templates?.length ?? 0;
        const completedTemplateIds = new Set(
          (inspectionRecords ?? [])
            .filter((r) => r.checklist_template_id && r.overall_result !== null)
            .map((r) => r.checklist_template_id as string)
        );
        checklistReady = (templates ?? []).filter((t) => completedTemplateIds.has(t.id)).length;
      }
    }
  }

  const ncrTotal = ncrs?.length ?? 0;
  const ncrReady = (ncrs ?? []).filter((ncr) => ncr.status === "closed").length;

  const calibrationTotal = calibrationRows?.length ?? 0;
  const calibrationReady = (calibrationRows ?? []).filter((r) => r.status !== "expired").length;

  const welderTotal = welderRows?.length ?? 0;
  const welderReady = (welderRows ?? []).filter((r) => r.status !== "expired").length;

  const materialTotal = materialRows?.length ?? 0;
  const materialReady = (materialRows ?? []).filter(
    (r) => (r.approval_status === "A" || r.approval_status === "B") && r.receipt_status === "released"
  ).length;

  const itpsCategory = toCategory("ITPs approved or client-accepted", itpReady, itpTotal);
  const inspectionRecordsCategory = toCategory("Inspection records with an issued IRN", recordReady, recordTotal);
  const checklistsCategory = toCategory("Completed checklists", checklistReady, checklistTotal);
  const calibrationCategory = toCategory("Calibration certificates in date", calibrationReady, calibrationTotal);
  const welderCategory = toCategory("Welder qualifications valid", welderReady, welderTotal);
  const materialCategory = toCategory("Materials approved and released", materialReady, materialTotal);
  const ncrsCategory = toCategory("NCRs closed", ncrReady, ncrTotal);
  const handoverCertificateCategory = toCategory("Handover certificate issued", (issuedDataBooks?.length ?? 0) > 0 ? 1 : 0, 1);

  const gatingCategories = [
    itpsCategory,
    inspectionRecordsCategory,
    checklistsCategory,
    calibrationCategory,
    welderCategory,
    materialCategory,
    ncrsCategory,
  ];
  const totalReady = gatingCategories.reduce((sum, c) => sum + c.ready, 0);
  const totalRequired = gatingCategories.reduce((sum, c) => sum + c.total, 0);
  const overallPercentage = totalRequired === 0 ? 100 : Math.round((totalReady / totalRequired) * 100);
  const openPunchItemCount = openPunchItems ?? 0;

  return {
    categories: gatingCategories,
    handoverCertificate: handoverCertificateCategory,
    openPunchItems: openPunchItemCount,
    overallPercentage,
    isReady: gatingCategories.every((c) => c.percentage === 100) && openPunchItemCount === 0,
  };
}

/**
 * Re-derives apps/web/lib/databook/discipline-breakdown.ts's computeDataBookDisciplineBreakdown for
 * this worker process (R88) — same reason and same convention as
 * computeDataBookReadinessForWorker above: the worker has no access to createSupabaseServerClient,
 * so the same aggregation over the same tables is re-derived here rather than imported. An
 * itp_item with no discipline_id, or an ncr with no itp_item_id, is excluded from every discipline
 * bucket — never guessed at or dumped into a fake "Unassigned" row.
 */
async function computeDataBookDisciplineBreakdownForWorker(projectId: string): Promise<DataBookPdfDisciplineRow[]> {
  const { data: itps } = await supabase.from("itps").select("id").eq("project_id", projectId).returns<{ id: string }[]>();
  const itpIds = (itps ?? []).map((itp) => itp.id);
  if (itpIds.length === 0) return [];

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id, itp_id")
    .in("itp_id", itpIds)
    .returns<{ id: string; itp_id: string }[]>();
  const sectionIds = (sections ?? []).map((s) => s.id);
  const sectionToItp = new Map((sections ?? []).map((s) => [s.id, s.itp_id]));
  if (sectionIds.length === 0) return [];

  const { data: items } = await supabase
    .from("itp_items")
    .select("id, section_id, discipline_id")
    .in("section_id", sectionIds)
    .not("discipline_id", "is", null)
    .returns<{ id: string; section_id: string; discipline_id: string }[]>();
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return [];

  const disciplineByItem = new Map(items!.map((i) => [i.id, i.discipline_id]));
  const itpByItem = new Map(items!.map((i) => [i.id, sectionToItp.get(i.section_id) ?? null]));

  const { data: records } = await supabase
    .from("inspection_records")
    .select("itp_item_id, overall_result, created_at")
    .in("itp_item_id", itemIds)
    .order("created_at", { ascending: true })
    .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string }[]>();

  const { data: ncrsRaw } = await supabase
    .from("ncrs" as never)
    .select("id, itp_item_id")
    .eq("project_id", projectId)
    .returns<{ id: string; itp_item_id: string | null }[]>();
  const ncrs = (ncrsRaw ?? []).filter((n): n is { id: string; itp_item_id: string } => n.itp_item_id !== null);

  const firstAttemptByItem = new Map<string, { overall_result: "pass" | "fail" | "partial" | null }>();
  for (const record of records ?? []) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }

  interface DisciplineAgg {
    itpIds: Set<string>;
    ncrCount: number;
    firstAttempts: number;
    firstTimePasses: number;
  }
  const byDiscipline = new Map<string, DisciplineAgg>();
  function agg(disciplineId: string): DisciplineAgg {
    let entry = byDiscipline.get(disciplineId);
    if (!entry) {
      entry = { itpIds: new Set(), ncrCount: 0, firstAttempts: 0, firstTimePasses: 0 };
      byDiscipline.set(disciplineId, entry);
    }
    return entry;
  }

  for (const item of items ?? []) {
    const itpId = itpByItem.get(item.id);
    if (itpId) agg(item.discipline_id).itpIds.add(itpId);
  }

  for (const [itemId, record] of firstAttemptByItem) {
    if (record.overall_result === null) continue;
    const disciplineId = disciplineByItem.get(itemId);
    if (!disciplineId) continue;
    const entry = agg(disciplineId);
    entry.firstAttempts += 1;
    if (record.overall_result === "pass") entry.firstTimePasses += 1;
  }

  for (const ncr of ncrs) {
    const disciplineId = disciplineByItem.get(ncr.itp_item_id);
    if (!disciplineId) continue;
    agg(disciplineId).ncrCount += 1;
  }

  if (byDiscipline.size === 0) return [];

  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .in("id", [...byDiscipline.keys()])
    .returns<{ id: string; code: string; name: string }[]>();
  const disciplineById = new Map((disciplines ?? []).map((d) => [d.id, d]));

  return [...byDiscipline.entries()]
    .map(([disciplineId, entry]) => {
      const discipline = disciplineById.get(disciplineId);
      return {
        disciplineCode: discipline?.code ?? "—",
        disciplineName: discipline?.name ?? "Unknown discipline",
        itpCount: entry.itpIds.size,
        ncrCount: entry.ncrCount,
        firstAttempts: entry.firstAttempts,
        firstTimePasses: entry.firstTimePasses,
        firstTimePassRate: entry.firstAttempts > 0 ? Math.round((entry.firstTimePasses / entry.firstAttempts) * 100) : null,
      };
    })
    .sort((a, b) => a.disciplineCode.localeCompare(b.disciplineCode));
}

/**
 * Every record the book lists, in the reference's order: ITPs (sections → activities → intervention
 * sign-offs → latest inspection record → IRN, plus the people on each approval step), then the
 * materials, welder, calibration, NCR and punch-list registers. Reads only.
 */
async function gatherDataBookContent(projectId: string): Promise<{
  itps: DataBookPdfItp[];
  calibrations: DataBookPdfData["calibrations"];
  welders: DataBookPdfData["welders"];
  materials: DataBookPdfData["materials"];
  ncrs: DataBookPdfData["ncrs"];
  punchItems: DataBookPdfData["punchItems"];
  nameById: Map<string, string>;
  parties: { name: string; partyType: string }[];
}> {
  type ItpRow = {
    id: string;
    itp_number: string;
    title: string;
    revision: number;
    status: string;
    phase: string;
    applicable_standard: string | null;
    prepared_by: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    approved_by: string | null;
    approved_at: string | null;
    client_accepted_by: string | null;
    client_accepted_at: string | null;
  };
  type SectionRow = { id: string; itp_id: string; sort_order: number };
  type ItemRow = {
    id: string;
    section_id: string;
    item_number: string;
    activity: string;
    acceptance_criteria: string | null;
    reference_spec: string | null;
    method: string | null;
    sort_order: number;
  };
  type SignoffRow = {
    itp_item_id: string;
    intervention: string;
    status: string;
    signed_off_at: string | null;
    signed_off_by: string | null;
    project_party_id: string;
  };
  type RecordRow = {
    itp_item_id: string;
    record_number: string;
    overall_result: string | null;
    inspection_date: string;
    inspector_id: string | null;
    irns: { irn_number: string }[] | { irn_number: string } | null;
  };

  const [itpRes, calRes, welderRes, matRes, ncrRes, punchRes] =
    await Promise.all([
      supabase
        .from("itps")
        .select(
          "id, itp_number, title, revision, status, phase, applicable_standard, prepared_by, reviewed_by, reviewed_at, approved_by, approved_at, client_accepted_by, client_accepted_at"
        )
        .eq("project_id", projectId)
        .order("itp_number", { ascending: true })
        .returns<ItpRow[]>(),
      supabase
        .from("calibration_register" as never)
        .select("instrument_name, cert_number, cal_date, due_date, status")
        .eq("project_id", projectId)
        .order("due_date", { ascending: true })
        .returns<{ instrument_name: string; cert_number: string; cal_date: string | null; due_date: string; status: string }[]>(),
      supabase
        .from("welder_qualification_register" as never)
        .select("welder_identifier, qualified_wps, qualified_ranges, expiry_date, status")
        .eq("project_id", projectId)
        .order("welder_identifier", { ascending: true })
        .returns<{ welder_identifier: string; qualified_wps: string; qualified_ranges: string | null; expiry_date: string; status: string }[]>(),
      supabase
        .from("material_register" as never)
        .select("material_description, heat_number, batch_number, po_reference, certificate_reference, approval_status, receipt_status")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .returns<
          {
            material_description: string;
            heat_number: string | null;
            batch_number: string | null;
            po_reference: string | null;
            certificate_reference: string | null;
            approval_status: string;
            receipt_status: string;
          }[]
        >(),
      supabase
        .from("ncrs" as never)
        .select("ncr_number, description, severity, status, closed_at")
        .eq("project_id", projectId)
        .order("ncr_number", { ascending: true })
        .returns<{ ncr_number: string; description: string; severity: string; status: string; closed_at: string | null }[]>(),
      supabase
        .from("punch_list_items" as never)
        .select("description, location, status, due_date, closed_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .returns<{ description: string; location: string | null; status: string; due_date: string | null; closed_at: string | null }[]>(),
    ]);

  // A data book is a controlled record: a failed read must fail the render, never produce a book that
  // silently lists "0 ITPs" (a transient database error previously did exactly that).
  const failed = [
    ["itps", itpRes.error],
    ["calibration_register", calRes.error],
    ["welder_qualification_register", welderRes.error],
    ["material_register", matRes.error],
    ["ncrs", ncrRes.error],
    ["punch_list_items", punchRes.error],
  ].find(([, error]) => error);
  if (failed) throw new Error(`Data book render aborted — could not read ${failed[0] as string}: ${(failed[1] as { message: string }).message}`);
  const itpRows = itpRes.data;
  const calRows = calRes.data;
  const welderRows = welderRes.data;
  const matRows = matRes.data;
  const ncrRows = ncrRes.data;
  const punchRows = punchRes.data;

  const itpIds = (itpRows ?? []).map((i) => i.id);
  const sections: SectionRow[] = itpIds.length
    ? ((await supabase.from("itp_sections").select("id, itp_id, sort_order").in("itp_id", itpIds).returns<SectionRow[]>()).data ?? [])
    : [];
  const sectionIds = sections.map((s) => s.id);
  const items: ItemRow[] = sectionIds.length
    ? ((
        await supabase
          .from("itp_items")
          .select("id, section_id, item_number, activity, acceptance_criteria, reference_spec, method, sort_order")
          .in("section_id", sectionIds)
          .returns<ItemRow[]>()
      ).data ?? [])
    : [];
  const itemIds = items.map((i) => i.id);

  let signoffs: SignoffRow[] = [];
  let records: RecordRow[] = [];
  if (itemIds.length) {
    const [signoffRes, recordRes] = await Promise.all([
      supabase
        .from("activity_signoff_progress")
        .select("itp_item_id, intervention, status, signed_off_at, signed_off_by, project_party_id")
        .in("itp_item_id", itemIds)
        .returns<SignoffRow[]>(),
      supabase
        .from("inspection_records")
        .select("itp_item_id, record_number, overall_result, inspection_date, inspector_id, irns(irn_number)")
        .in("itp_item_id", itemIds)
        .order("created_at", { ascending: false })
        .returns<RecordRow[]>(),
    ]);
    if (signoffRes.error || recordRes.error) throw new Error(`Data book render aborted — could not read sign-offs or inspection records: ${(signoffRes.error ?? recordRes.error)!.message}`);
    signoffs = signoffRes.data ?? [];
    records = recordRes.data ?? [];
  }

  const partyIds = [...new Set(signoffs.map((s) => s.project_party_id))];
  const parties: { id: string; name: string }[] = partyIds.length
    ? ((await supabase.from("project_parties").select("id, name").in("id", partyIds).returns<{ id: string; name: string }[]>()).data ?? [])
    : [];
  const partyName = new Map(parties.map((p) => [p.id, p.name]));
  const { data: projectPartyRows } = await supabase
    .from("project_parties")
    .select("name, party_type")
    .eq("project_id", projectId)
    .order("party_type")
    .returns<{ name: string; party_type: string }[]>();

  const userIds = new Set<string>();
  for (const i of itpRows ?? []) {
    for (const id of [i.prepared_by, i.reviewed_by, i.approved_by, i.client_accepted_by]) if (id) userIds.add(id);
  }
  for (const s of signoffs) if (s.signed_off_by) userIds.add(s.signed_off_by);
  for (const r of records) if (r.inspector_id) userIds.add(r.inspector_id);
  const users: { id: string; full_name: string }[] = userIds.size
    ? ((await supabase.from("users").select("id, full_name").in("id", [...userIds]).returns<{ id: string; full_name: string }[]>()).data ?? [])
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.full_name]));
  const name = (id: string | null) => (id ? (nameById.get(id) ?? null) : null);

  // Newest inspection record per activity is the one the book presents (a re-inspection supersedes).
  const latestRecord = new Map<string, RecordRow>();
  for (const r of records) if (!latestRecord.has(r.itp_item_id)) latestRecord.set(r.itp_item_id, r);

  const sectionOrder = new Map(sections.map((s) => [s.id, s.sort_order]));
  const sectionItp = new Map(sections.map((s) => [s.id, s.itp_id]));

  function recordState(overall: string | null, irn: string | null): DataBookRecordState {
    if (overall === null) return "Draft";
    if (overall === "fail") return "Rejected";
    if (irn) return overall === "pass" ? "Accepted" : "Accepted with comments";
    return "In review";
  }

  const itps: DataBookPdfItp[] = (itpRows ?? []).map((itp) => {
    const itpItems = items
      .filter((i) => sectionItp.get(i.section_id) === itp.id)
      .sort(
        (a, b) =>
          (sectionOrder.get(a.section_id) ?? 0) - (sectionOrder.get(b.section_id) ?? 0) ||
          a.sort_order - b.sort_order ||
          a.item_number.localeCompare(b.item_number, undefined, { numeric: true })
      );
    const activities: DataBookPdfActivity[] = itpItems.map((item) => {
      const rec = latestRecord.get(item.id);
      const irn = rec ? (Array.isArray(rec.irns) ? (rec.irns[0]?.irn_number ?? null) : (rec.irns?.irn_number ?? null)) : null;
      return {
        itemNumber: item.item_number,
        activity: item.activity,
        criteria: item.acceptance_criteria,
        reference: item.reference_spec,
        method: item.method,
        interventions: signoffs
          .filter((s) => s.itp_item_id === item.id)
          .map((s) => ({
            code: s.intervention,
            partyName: partyName.get(s.project_party_id) ?? "Party",
            status: s.status,
            signedBy: name(s.signed_off_by),
            signedAt: s.signed_off_at,
          })),
        recordNumber: rec?.record_number ?? null,
        result: rec?.overall_result ?? null,
        inspectionDate: rec?.inspection_date ?? null,
        inspector: name(rec?.inspector_id ?? null),
        irnNumber: irn,
        state: rec ? recordState(rec.overall_result, irn) : "Missing",
      };
    });
    return {
      itpNumber: itp.itp_number,
      title: itp.title,
      revision: itp.revision,
      status: itp.status,
      phase: itp.phase,
      standard: itp.applicable_standard,
      preparedBy: name(itp.prepared_by),
      reviewedBy: name(itp.reviewed_by),
      reviewedAt: itp.reviewed_at,
      approvedBy: name(itp.approved_by),
      approvedAt: itp.approved_at,
      acceptedBy: name(itp.client_accepted_by),
      acceptedAt: itp.client_accepted_at,
      activities,
    };
  });

  return {
    itps,
    calibrations: (calRows ?? []).map((c) => ({
      instrument: c.instrument_name,
      certNumber: c.cert_number,
      calDate: c.cal_date,
      dueDate: c.due_date,
      status: c.status,
    })),
    welders: (welderRows ?? []).map((w) => ({
      welder: w.welder_identifier,
      wps: w.qualified_wps,
      ranges: w.qualified_ranges,
      expiry: w.expiry_date,
      status: w.status,
    })),
    materials: (matRows ?? []).map((m) => ({
      description: m.material_description,
      heat: m.heat_number,
      batch: m.batch_number,
      po: m.po_reference,
      certificate: m.certificate_reference,
      approval: m.approval_status,
      receipt: m.receipt_status,
    })),
    ncrs: (ncrRows ?? []).map((n) => ({
      number: n.ncr_number,
      description: n.description,
      severity: n.severity,
      status: n.status,
      closedAt: n.closed_at,
    })),
    punchItems: (punchRows ?? []).map((p) => ({
      description: p.description,
      location: p.location,
      status: p.status,
      dueDate: p.due_date,
      closedAt: p.closed_at,
    })),
    nameById,
    parties: (projectPartyRows ?? []).map((p) => ({ name: p.name, partyType: p.party_type })),
  };
}

/**
 * Fetches everything needed for the branded, cover-page-plus-summary Data Book PDF (R86, R108),
 * renders it via Puppeteer, uploads the result to Storage, and returns the path the caller records
 * on the job row. Mirrors renderNcrPdf.ts's structure exactly, for Data Book data instead of NCR
 * data.
 */
/** Prints the book. Shared by both passes so the page count of pass 1 matches the final PDF. */
async function printBookPdf(html: string, dataBook: DataBookRow): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        landscape: false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
        displayHeaderFooter: true,
        headerTemplate: `
          <div style="width:100%;font-size:8px;color:#444;padding:0 15mm;display:flex;gap:60px;font-family:Calibri,Arial,Helvetica,sans-serif;">
            <span>JAGS ASSURANCE</span><span>DATA BOOK</span>
          </div>`,
        footerTemplate: `
          <div style="width:100%;font-size:7.5px;color:#444;padding:0 15mm;display:flex;justify-content:flex-end;gap:14px;font-family:Calibri,Arial,Helvetica,sans-serif;">
            <span>${dataBook.book_number} | R00 | ${dataBookIssueLabel(dataBook.status, !!dataBook.override_reason)}</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      })
    );
  } finally {
    await page.close();
  }
}

/** Reads a printed PDF back and returns the physical page each section starts on, using the
 *  invisible "§id§" markers the template puts at the top of every section. */
async function sectionPageMap(pdf: Buffer): Promise<Record<string, number>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false }).promise;
  const map: Record<string, number> = {};
  for (let p = 1; p <= doc.numPages; p++) {
    const text = (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
    for (const m of text.matchAll(/§([a-z0-9-]+)§/g)) if (map[m[1]] === undefined) map[m[1]] = p;
  }
  await doc.destroy();
  return map;
}

export async function renderDataBookPdf(payload: RenderDataBookPdfPayload): Promise<{ resultStoragePath: string }> {
  const { dataBook, data } = await buildDataBookHtml(payload.data_book_id);

  // Pass 1 prints without page numbers to learn where each section lands; pass 2 prints the contents
  // page and the register's "Form page" column with those real numbers. The placeholders occupy the
  // same space, so the page count is stable; if it ever shifts, one more pass settles it.
  let pageMap: Record<string, number> = {};
  let pdfBuffer = await printBookPdf(buildDataBookPdfHtml(data, pageMap), dataBook);
  for (let pass = 0; pass < 2; pass++) {
    const next = await sectionPageMap(pdfBuffer);
    const stable = JSON.stringify(next) === JSON.stringify(pageMap);
    pageMap = next;
    if (stable) break;
    pdfBuffer = await printBookPdf(buildDataBookPdfHtml(data, pageMap), dataBook);
  }

  const storagePath = `databooks/${dataBook.id}/${dataBook.book_number}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from(GENERATED_DOCUMENTS_BUCKET)
    .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true });

  if (uploadError) {
    throw new Error(`Failed to upload rendered PDF: ${uploadError.message}`);
  }

  await autoFileVaultDocument(supabase, {
    projectId: dataBook.project_id,
    folderKey: "certificates",
    title: `Data Book ${dataBook.book_number} — ${dataBook.title} (${dataBook.status})`,
    documentReference: dataBook.book_number,
    revision: "0",
    storagePath,
    fileSize: pdfBuffer.length,
    generatedBy: payload.requested_by,
    autoRevision: true,
  });

  return { resultStoragePath: storagePath };
}

/** Loads the book + project + every record and builds the printable HTML. Exported for local previews. */
export async function buildDataBookHtml(dataBookId: string): Promise<{ dataBook: DataBookRow; html: string; data: DataBookPdfData }> {
  const { data: dataBook, error: dataBookError } = await supabase
    .from("data_books" as never)
    .select("id, project_id, book_number, title, status, compiled_at, compiled_by, override_reason, override_by")
    .eq("id", dataBookId)
    .single<DataBookRow>();

  if (dataBookError || !dataBook) {
    throw new Error(`Data book ${dataBookId} not found: ${dataBookError?.message ?? "no row"}`);
  }

  const [{ data: project }, readiness, disciplineBreakdown, content] = await Promise.all([
    supabase
      .from("projects")
      .select("organization_id, project_number, name, site_location, organizations(name)")
      .eq("id", dataBook.project_id)
      .maybeSingle<{
        organization_id: string;
        project_number: string;
        name: string;
        site_location: string | null;
        organizations: { name: string } | null;
      }>(),
    computeDataBookReadinessForWorker(dataBook.project_id),
    computeDataBookDisciplineBreakdownForWorker(dataBook.project_id),
    gatherDataBookContent(dataBook.project_id),
  ]);

  const templateData: DataBookPdfData = {
    bookNumber: dataBook.book_number,
    title: dataBook.title,
    status: dataBook.status,
    projectName: project?.name ?? "",
    projectNumber: project?.project_number ?? "",
    organizationName: project?.organizations?.name ?? null,
    categories: readiness.categories,
    handoverCertificate: readiness.handoverCertificate,
    disciplineBreakdown,
    openPunchItems: readiness.openPunchItems,
    overallPercentage: readiness.overallPercentage,
    isReady: readiness.isReady,
    compiledAt: dataBook.compiled_at,
    compiledBy: dataBook.compiled_by ? (content.nameById.get(dataBook.compiled_by) ?? null) : null,
    overrideReason: dataBook.override_reason,
    overrideBy: dataBook.override_by ? (content.nameById.get(dataBook.override_by) ?? null) : null,
    siteLocation: project?.site_location ?? null,
    parties: content.parties,
    itps: content.itps,
    calibrations: content.calibrations,
    welders: content.welders,
    materials: content.materials,
    ncrs: content.ncrs,
    punchItems: content.punchItems,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  const html = buildDataBookPdfHtml(templateData);
  return { dataBook, html, data: templateData };
}
