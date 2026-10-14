import { getSharedBrowser } from "../browserPool";
import { withBidi } from "./bidi";
import { supabase } from "../supabase";
import {
  buildDataBookPdfHtml,
  dataBookIssueLabel,
  bookRevLabel,
  type DataBookPdfActivity,
  type DataBookPdfCategory,
  type DataBookPdfData,
  type DataBookPdfDisciplineRow,
  type DataBookPdfItp,
  type DataBookRecordState,
} from "./dataBookTemplate";
import type { RenderDataBookPdfPayload } from "./types";
import { getOrgBranding } from "./orgBranding";
import { autoFileVaultDocument, uploadGeneratedFile, buildGeneratedPath, shouldFileDataBook } from "./vaultAutoFile";
import { createHash } from "node:crypto";
import { removeGeneratedFile, sourceHash } from "./generatedDocument";
import { sealFooterSpan } from "./integritySeal";
import { PermanentJobError } from "./jobAbort";
import { assertBookWithinLimits, escapeHtml, stripGeneratedPrefix, fetchAllIn, fetchAllPages, fetchCountedRegisterRows, normaliseOverrideItems, registerAsOf } from "./dataBookHelpers";
import { calibrationLabel, calibrationStatus, personnelStatus, qualificationLabel, welderStatus } from "./registerStatus";
import { setHtmlContentAndSettle } from "./renderHtml";

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
  revision: number | null;
  override_items: unknown;
}

interface CertificateRow {
  issued_date: string | null;
  issued_by: string | null;
  is_conditional: boolean | null;
  conditional_reason: string | null;
  conditional_open_items: unknown;
}

/** Ready = finalised with Pass, or Conditional Pass with clearance issued. Draft/open/fail are not ready. */
function isStandaloneCleared(r: { status: string; conclusion: string | null; cleared_at: string | null }): boolean {
  if (r.status !== "completed") return false;
  if (r.conclusion === "pass") return true;
  return r.conclusion === "conditional_pass" && !!r.cleared_at;
}

function toCategory(label: string, ready: number, total: number): DataBookPdfCategory {
  return { label, ready, total, percentage: total === 0 ? 100 : Math.round((ready / total) * 100) };
}

/**
 * Re-derives apps/web/lib/databook/readiness.ts's computeDataBookReadiness for this worker process. Register expiries are evaluated
 * against `asOf` (the issue date for an issued book, today otherwise) so an issued book never drifts.
 * Not a straight import: that module goes through createSupabaseServerClient() (Next.js
 * cookie-bound, server-only) which the worker has no access to — the worker only ever holds a
 * service-role Supabase client (../supabase). Every category, formula, and gating rule below is
 * kept identical to readiness.ts on purpose; if that file's categories or thresholds ever change,
 * this needs the same change made here.
 */
async function computeDataBookReadinessForWorker(projectId: string, asOf: Date): Promise<{
  categories: DataBookPdfCategory[];
  handoverCertificate: DataBookPdfCategory;
  openPunchItems: number;
  overallPercentage: number;
  isReady: boolean;
}> {
  type InspRow = {
    id: string;
    itp_item_id: string | null;
    created_at: string;
    checklist_template_id: string | null;
    overall_result: string | null;
    irns: { id: string; voided_at: string | null }[] | { id: string; voided_at: string | null } | null;
  };
  const [itps, inspectionRecords, ncrs, openPunchRes, calibrationRows, welderRows, materialRows, issuedDataBooks, personnelRows, standaloneRows] =
    await Promise.all([
      fetchAllPages("itps", (f, t) =>
        supabase.from("itps" as never).select("id, status, revision_needs_approval").eq("project_id" as never, projectId as never).order("id" as never).range(f, t).returns<{ id: string; status: string; revision_needs_approval: boolean }[]>()
      ),
      fetchAllPages<InspRow>("inspection_records", (f, t) =>
        supabase
          .from("inspection_records")
          .select("id, itp_item_id, created_at, checklist_template_id, overall_result, irns(id, voided_at)")
          .eq("project_id", projectId)
          .order("id")
          .range(f, t)
          .returns<InspRow[]>()
      ),
      fetchAllPages("ncrs", (f, t) =>
        supabase
          .from("ncrs" as never)
          .select("id, status")
          .eq("project_id", projectId)
          // Match apps/web readiness: observations are excluded, rows with no severity still count.
          .or("severity.is.null,severity.neq.observation")
          .order("id")
          .range(f, t)
          .returns<{ id: string; status: string }[]>()
      ),
      supabase.from("punch_list_items" as never).select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "closed"),
      // E2: unverified and superseded/retired/withdrawn register rows are ignored (same as apps/web readiness).
      fetchCountedRegisterRows<{ id: string; due_date: string }>("calibration_register", "id, due_date", (sel, f, t) =>
        supabase.from("calibration_register" as never).select(sel).eq("project_id", projectId).order("id").range(f, t).returns<{ id: string; due_date: string }[]>()
      ),
      fetchCountedRegisterRows<{ id: string; expiry_date: string }>("welder_qualification_register", "id, expiry_date", (sel, f, t) =>
        supabase.from("welder_qualification_register" as never).select(sel).eq("project_id", projectId).order("id").range(f, t).returns<{ id: string; expiry_date: string }[]>()
      ),
      fetchCountedRegisterRows<{ id: string; approval_status: string; receipt_status: string }>("material_register", "id, approval_status, receipt_status", (sel, f, t) =>
        supabase
          .from("material_register" as never)
          .select(sel)
          .eq("project_id", projectId)
          .order("id")
          .range(f, t)
          .returns<{ id: string; approval_status: string; receipt_status: string }[]>()
      ),
      fetchAllPages("data_books", (f, t) =>
        supabase.from("data_books" as never).select("id").eq("project_id", projectId).eq("status", "issued").order("id").range(f, t).returns<{ id: string }[]>()
      ),
      fetchCountedRegisterRows<{ id: string; expiry_date: string }>("personnel_certifications", "id, expiry_date", (sel, f, t) =>
        supabase.from("personnel_certifications" as never).select(sel).eq("project_id", projectId).order("id").range(f, t).returns<{ id: string; expiry_date: string }[]>()
      ),
      fetchAllPages("standalone_assignments", (f, t) =>
        supabase
          .from("standalone_assignments" as never)
          .select("id, status, conclusion, cleared_at")
          .eq("project_id", projectId)
          .order("id")
          .range(f, t)
          .returns<{ id: string; status: string; conclusion: string | null; cleared_at: string | null }[]>()
      ),
    ]);
  if (openPunchRes.error) throw new Error(`Data book render aborted — could not read punch_list_items: ${openPunchRes.error.message}`);
  const openPunchItems = openPunchRes.count;

  // Superseded / withdrawn ITPs no longer count (same as apps/web readiness.ts and data_book_gate_failures()).
  const liveItps = (itps ?? []).filter((itp) => itp.status !== "superseded" && itp.status !== "withdrawn");
  const itpTotal = liveItps.length;
  const itpReady = liveItps.filter((itp) => (itp.status === "approved" || itp.status === "client_accepted") && !itp.revision_needs_approval).length;

  // KEEP IN SYNC with apps/web/lib/databook/readiness.ts: latest COMPLETED record per itp_item, pass/partial only.
  const latestByItem = new Map<string, NonNullable<typeof inspectionRecords>[number]>();
  for (const r of inspectionRecords ?? []) {
    if (!r.overall_result) continue;
    const key = r.itp_item_id ?? r.id;
    const cur = latestByItem.get(key);
    if (!cur || r.created_at > cur.created_at) latestByItem.set(key, r);
  }
  const countedRecords = [...latestByItem.values()].filter((r) => r.overall_result === "pass" || r.overall_result === "partial");
  const recordTotal = countedRecords.length;
  const recordReady = countedRecords.filter((record) =>
    (Array.isArray(record.irns) ? record.irns : record.irns ? [record.irns] : []).some((i) => !i.voided_at)
  ).length;

  const itpIds = (
    await fetchAllPages("itps (approved)", (f, t) =>
      supabase.from("itps").select("id").eq("project_id", projectId).in("status", ["approved", "client_accepted"]).order("id").range(f, t).returns<{ id: string }[]>()
    )
  ).map((i) => i.id);
  let checklistTotal = 0;
  let checklistReady = 0;
  let activityTotal = 0;
  let activityReady = 0;
  let holdTotal = 0;
  let holdReady = 0;
  if (itpIds.length > 0) {
    const sections = await fetchAllIn("itp_sections", itpIds, (ids, f, t) =>
      supabase.from("itp_sections").select("id").in("itp_id", ids).order("id").range(f, t).returns<{ id: string }[]>()
    );
    const sectionIds = sections.map((s) => s.id);
    if (sectionIds.length > 0) {
      const allItems = await fetchAllIn("itp_items", sectionIds, (ids, f, t) =>
        supabase.from("itp_items").select("id, evidence_type").in("section_id", ids).order("id").range(f, t).returns<{ id: string; evidence_type: number }[]>()
      );
      const items = allItems.filter((i) => i.evidence_type === 1);
      const itemIds = items.map((i) => i.id);
      // KEEP IN SYNC with apps/web/lib/databook/readiness.ts: execution gates (S7-06).
      activityTotal = items.length;
      activityReady = items.filter((i) => {
        const latest = latestByItem.get(i.id);
        return latest && (latest.overall_result === "pass" || latest.overall_result === "partial");
      }).length;
      const holds = await fetchAllIn("activity_signoff_progress", allItems.map((i) => i.id), (ids, f, t) =>
        supabase
          .from("activity_signoff_progress")
          .select("id, status, intervention")
          .in("itp_item_id", ids)
          .in("intervention", ["H", "W"])
          .order("id")
          .range(f, t)
          .returns<{ id: string; status: string; intervention: string }[]>()
      );
      holdTotal = holds.length;
      holdReady = holds.filter((h) => h.status === "signed_off" || (h.intervention === "W" && h.status === "proceeded_no_response")).length;
      if (itemIds.length > 0) {
        const templates = await fetchAllIn("checklist_templates", itemIds, (ids, f, t) =>
          supabase.from("checklist_templates" as never).select("id").in("itp_item_id", ids).order("id").range(f, t).returns<{ id: string }[]>()
        );
        checklistTotal = templates.length;
        const completedTemplateIds = new Set(
          (inspectionRecords ?? [])
            .filter((r) => r.checklist_template_id && r.overall_result !== null)
            .map((r) => r.checklist_template_id as string)
        );
        checklistReady = templates.filter((t) => completedTemplateIds.has(t.id)).length;
      }
    }
  }

  const ncrTotal = ncrs?.length ?? 0;
  const ncrReady = (ncrs ?? []).filter((ncr) => ncr.status === "closed").length;

  const calibrationTotal = calibrationRows?.length ?? 0;
  const calibrationReady = (calibrationRows ?? []).filter((r) => calibrationStatus(r.due_date, asOf) !== "expired").length;

  const welderTotal = welderRows?.length ?? 0;
  const welderReady = (welderRows ?? []).filter((r) => welderStatus(r.expiry_date, asOf) !== "expired").length;

  const personnelTotal = personnelRows?.length ?? 0;
  const personnelReady = (personnelRows ?? []).filter((r) => personnelStatus(r.expiry_date, asOf) !== "expired").length;

  const standaloneTotal = standaloneRows?.length ?? 0;
  const standaloneReady = (standaloneRows ?? []).filter(isStandaloneCleared).length;

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
  const personnelCategory = toCategory("Personnel certifications valid", personnelReady, personnelTotal);
  const standaloneCategory = toCategory("Standalone assignments cleared", standaloneReady, standaloneTotal);
  const ncrsCategory = toCategory("NCRs closed", ncrReady, ncrTotal);
  const activitiesCategory = toCategory("ITP activities inspected and passed", activityReady, activityTotal);
  const holdPointsCategory = toCategory("Hold and witness points signed off", holdReady, holdTotal);
  const handoverCertificateCategory = toCategory("Handover certificate issued", (issuedDataBooks?.length ?? 0) > 0 ? 1 : 0, 1);

  const gatingCategories = [
    itpsCategory,
    inspectionRecordsCategory,
    checklistsCategory,
    calibrationCategory,
    welderCategory,
    personnelCategory,
    materialCategory,
    standaloneCategory,
    ncrsCategory,
    activitiesCategory,
    holdPointsCategory,
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
  const itps = await fetchAllPages("itps", (f, t) =>
    supabase.from("itps").select("id").eq("project_id", projectId).order("id").range(f, t).returns<{ id: string }[]>()
  );
  const itpIds = itps.map((itp) => itp.id);
  if (itpIds.length === 0) return [];

  const sections = await fetchAllIn("itp_sections", itpIds, (ids, f, t) =>
    supabase.from("itp_sections").select("id, itp_id").in("itp_id", ids).order("id").range(f, t).returns<{ id: string; itp_id: string }[]>()
  );
  const sectionIds = sections.map((s) => s.id);
  const sectionToItp = new Map(sections.map((s) => [s.id, s.itp_id]));
  if (sectionIds.length === 0) return [];

  const items = await fetchAllIn("itp_items", sectionIds, (ids, f, t) =>
    supabase
      .from("itp_items")
      .select("id, section_id, discipline_id")
      .in("section_id", ids)
      .not("discipline_id", "is", null)
      .order("id")
      .range(f, t)
      .returns<{ id: string; section_id: string; discipline_id: string }[]>()
  );
  const itemIds = items.map((i) => i.id);
  if (itemIds.length === 0) return [];

  const records = await fetchAllIn("inspection_records", itemIds, (ids, f, t) =>
    supabase
      .from("inspection_records")
      .select("id, itp_item_id, overall_result, created_at")
      .in("itp_item_id", ids)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(f, t)
      .returns<{ id: string; itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string }[]>()
  );
  // Chunked reads concatenate per chunk; restore global first-attempt order.
  records.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

  const ncrsRaw = await fetchAllPages("ncrs", (f, t) =>
    supabase.from("ncrs" as never).select("id, itp_item_id").eq("project_id", projectId).order("id").range(f, t).returns<{ id: string; itp_item_id: string | null }[]>()
  );
  const ncrs = ncrsRaw.filter((n): n is { id: string; itp_item_id: string } => n.itp_item_id !== null);

  const firstAttemptByItem = new Map<string, { overall_result: "pass" | "fail" | "partial" | null }>();
  for (const record of records) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }
  const disciplineByItem = new Map(items!.map((i) => [i.id, i.discipline_id]));
  const itpByItem = new Map(items!.map((i) => [i.id, sectionToItp.get(i.section_id) ?? null]));


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

  const disciplines = await fetchAllIn("master_disciplines", [...byDiscipline.keys()], (ids, f, t) =>
    supabase.from("master_disciplines").select("id, code, name").in("id", ids).order("id").range(f, t).returns<{ id: string; code: string; name: string }[]>()
  );
  const disciplineById = new Map(disciplines.map((d) => [d.id, d]));

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
async function gatherDataBookContent(projectId: string, asOf: Date, extraUserIds: string[] = []): Promise<{
  itps: DataBookPdfItp[];
  calibrations: DataBookPdfData["calibrations"];
  welders: DataBookPdfData["welders"];
  materials: DataBookPdfData["materials"];
  personnel: NonNullable<DataBookPdfData["personnel"]>;
  standalone: NonNullable<DataBookPdfData["standalone"]>;
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
    irns: { irn_number: string; voided_at: string | null }[] | { irn_number: string; voided_at: string | null } | null;
  };

  // Every read is a full page loop (no silent 1000-row cap) and fails the render if it cannot finish.
  type PunchRow = {
    description: string;
    location: string | null;
    status: string;
    due_date: string | null;
    closed_at: string | null;
    priority: string | null;
    source: string | null;
    closing_evidence: string | null;
    verification_notes: string | null;
    closed_by: string | null;
    project_parties: { name: string } | { name: string }[] | null;
  };
  type PersonnelRow = {
    project_party_id: string;
    certification_type: string;
    cert_number: string | null;
    expiry_date: string;
    project_parties: { name: string } | { name: string }[] | null;
  };
  type StandaloneRow = {
    assignment_number: string;
    assignment_type: string;
    equipment_description: string;
    serial_tag: string | null;
    assignment_date: string | null;
    status: string;
    conclusion: string | null;
    cleared_at: string | null;
    clearance_number: string | null;
  };
  type NcrRow = { id: string; ncr_number: string; description: string; severity: string; status: string; closed_at: string | null; closed_by: string | null; root_cause: string | null; corrective_action: string | null; preventive_action: string | null; verification_notes: string | null };
  type MatRow = {
    supplier: string | null;
    quantity: string | null;
    released_at: string | null;
    material_description: string;
    heat_number: string | null;
    batch_number: string | null;
    po_reference: string | null;
    certificate_reference: string | null;
    approval_status: string;
    receipt_status: string;
  };
  type CalRow = { instrument_name: string; cert_number: string; cal_date: string | null; due_date: string; status: string };
  type WelderRow = { welder_identifier: string; qualified_wps: string; qualified_ranges: string | null; expiry_date: string; status: string };
  const [itpRows, calRows, welderRows, matRows, ncrRows, punchRows, personnelRows, standaloneRows] = await Promise.all([
    fetchAllPages<ItpRow>("itps", (f, t) =>
      supabase
        .from("itps")
        .select(
          "id, itp_number, title, revision, status, phase, applicable_standard, prepared_by, reviewed_by, reviewed_at, approved_by, approved_at, client_accepted_by, client_accepted_at"
        )
        .eq("project_id", projectId)
        // Part C lists issued ITPs only ("Approved ITPs listed in Part C at their stated revision").
        .in("status", ["approved", "client_accepted"])
        .order("itp_number", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<ItpRow[]>()
    ),
    fetchAllPages<CalRow>("calibration_register", (f, t) =>
      supabase
        .from("calibration_register" as never)
        .select("id, instrument_name, cert_number, cal_date, due_date, status")
        .eq("project_id", projectId)
        .order("due_date", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<CalRow[]>()
    ),
    fetchAllPages<WelderRow>("welder_qualification_register", (f, t) =>
      supabase
        .from("welder_qualification_register" as never)
        .select("id, welder_identifier, qualified_wps, qualified_ranges, expiry_date, status")
        .eq("project_id", projectId)
        .order("welder_identifier", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<WelderRow[]>()
    ),
    fetchAllPages<MatRow>("material_register", (f, t) =>
      supabase
        .from("material_register" as never)
        .select("id, material_description, heat_number, batch_number, po_reference, certificate_reference, approval_status, receipt_status, supplier, quantity, released_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<MatRow[]>()
    ),
    fetchAllPages<NcrRow>("ncrs", (f, t) =>
      supabase
        .from("ncrs" as never)
        .select("id, ncr_number, description, severity, status, closed_at, closed_by, root_cause, corrective_action, preventive_action, verification_notes")
        .eq("project_id", projectId)
        .order("ncr_number", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<NcrRow[]>()
    ),
    fetchAllPages<PunchRow>("punch_list_items", (f, t) =>
      supabase
        .from("punch_list_items" as never)
        .select("id, description, location, status, due_date, closed_at, priority, source, closing_evidence, verification_notes, closed_by, project_parties(name)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<PunchRow[]>()
    ),
    fetchAllPages<PersonnelRow>("personnel_certifications", (f, t) =>
      supabase
        .from("personnel_certifications" as never)
        .select("id, project_party_id, certification_type, cert_number, expiry_date, project_parties(name)")
        .eq("project_id", projectId)
        .order("expiry_date", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<PersonnelRow[]>()
    ),
    fetchAllPages<StandaloneRow>("standalone_assignments", (f, t) =>
      supabase
        .from("standalone_assignments" as never)
        .select("id, assignment_number, assignment_type, equipment_description, serial_tag, assignment_date, status, conclusion, cleared_at, clearance_number")
        .eq("project_id", projectId)
        .eq("status", "completed")
        .order("assignment_number", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t)
        .returns<StandaloneRow[]>()
    ),
  ]);

  // NCR closer names and evidence counts (best-effort: a failure is logged and leaves those cells blank).
  const ncrCloserIds = [...new Set(ncrRows.map((n) => n.closed_by).filter((v): v is string => !!v))];
  const ncrIdList = ncrRows.map((n) => n.id);
  const closerNames = new Map<string, string>();
  try {
    const closers = await fetchAllIn<{ id: string; full_name: string }>("users (ncr closers)", ncrCloserIds, (ids, f, t) =>
      supabase.from("users").select("id, full_name").in("id", ids).order("id").range(f, t).returns<{ id: string; full_name: string }[]>()
    );
    for (const u of closers) closerNames.set(u.id, u.full_name);
  } catch (err) {
    console.warn("[renderDataBookPdf] NCR closer names unavailable:", err instanceof Error ? err.message : err);
  }
  const evidenceCounts = new Map<string, number>();
  try {
    const photos = await fetchAllIn<{ id: string; ncr_id: string }>("ncr_photos", ncrIdList, (ids, f, t) =>
      supabase.from("ncr_photos" as never).select("id, ncr_id").in("ncr_id", ids).order("id").range(f, t).returns<{ id: string; ncr_id: string }[]>()
    );
    for (const r of photos) evidenceCounts.set(r.ncr_id, (evidenceCounts.get(r.ncr_id) ?? 0) + 1);
  } catch (err) {
    console.warn("[renderDataBookPdf] NCR evidence counts unavailable:", err instanceof Error ? err.message : err);
  }

  const itpIds = itpRows.map((i) => i.id);
  const sections: SectionRow[] = await fetchAllIn<SectionRow>("itp_sections", itpIds, (ids, f, t) =>
    supabase.from("itp_sections").select("id, itp_id, sort_order").in("itp_id", ids).order("id").range(f, t).returns<SectionRow[]>()
  );
  const sectionIds = sections.map((s) => s.id);
  const items: ItemRow[] = await fetchAllIn<ItemRow>("itp_items", sectionIds, (ids, f, t) =>
    supabase
      .from("itp_items")
      .select("id, section_id, item_number, activity, acceptance_criteria, reference_spec, method, sort_order")
      .in("section_id", ids)
      .order("id")
      .range(f, t)
      .returns<ItemRow[]>()
  );
  const itemIds = items.map((i) => i.id);

  const signoffs: SignoffRow[] = await fetchAllIn<SignoffRow>("activity_signoff_progress", itemIds, (ids, f, t) =>
    supabase
      .from("activity_signoff_progress")
      .select("id, itp_item_id, intervention, status, signed_off_at, signed_off_by, project_party_id")
      .in("itp_item_id", ids)
      .order("id")
      .range(f, t)
      .returns<SignoffRow[]>()
  );
  type RecordWithMeta = RecordRow & { id: string; created_at: string };
  const records: RecordWithMeta[] = await fetchAllIn<RecordWithMeta>("inspection_records", itemIds, (ids, f, t) =>
    supabase
      .from("inspection_records")
      .select("id, created_at, itp_item_id, record_number, overall_result, inspection_date, inspector_id, irns(irn_number, voided_at)")
      .in("itp_item_id", ids)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(f, t)
      .returns<RecordWithMeta[]>()
  );
  // Chunked reads concatenate per chunk; restore newest-first so the first hit per activity is the latest.
  records.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const partyIds = [...new Set(signoffs.map((s) => s.project_party_id))];
  const parties = await fetchAllIn<{ id: string; name: string }>("project_parties", partyIds, (ids, f, t) =>
    supabase.from("project_parties").select("id, name").in("id", ids).order("id").range(f, t).returns<{ id: string; name: string }[]>()
  );
  const partyName = new Map(parties.map((p) => [p.id, p.name]));
  const projectPartyRows = await fetchAllPages<{ id: string; name: string; party_type: string }>("project_parties (project)", (f, t) =>
    supabase
      .from("project_parties")
      .select("id, name, party_type")
      .eq("project_id", projectId)
      .order("party_type")
      .order("id")
      .range(f, t)
      .returns<{ id: string; name: string; party_type: string }[]>()
  );

  const userIds = new Set<string>();
  for (const i of itpRows) {
    for (const id of [i.prepared_by, i.reviewed_by, i.approved_by, i.client_accepted_by]) if (id) userIds.add(id);
  }
  for (const s of signoffs) if (s.signed_off_by) userIds.add(s.signed_off_by);
  for (const p of punchRows) if (p.closed_by) userIds.add(p.closed_by);
  for (const r of records) if (r.inspector_id) userIds.add(r.inspector_id);
  for (const id of extraUserIds) userIds.add(id);
  const users = await fetchAllIn<{ id: string; full_name: string }>("users", [...userIds], (ids, f, t) =>
    supabase.from("users").select("id, full_name").in("id", ids).order("id").range(f, t).returns<{ id: string; full_name: string }[]>()
  );
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

  const itps: DataBookPdfItp[] = itpRows.map((itp) => {
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
      const irn = rec
        ? ((Array.isArray(rec.irns) ? rec.irns : rec.irns ? [rec.irns] : []).find((i) => !i.voided_at)?.irn_number ?? null)
        : null;
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
    calibrations: calRows.map((c) => ({
      instrument: c.instrument_name,
      certNumber: c.cert_number,
      calDate: c.cal_date,
      dueDate: c.due_date,
      status: calibrationLabel(calibrationStatus(c.due_date, asOf)),
    })),
    welders: welderRows.map((w) => ({
      welder: w.welder_identifier,
      wps: w.qualified_wps,
      ranges: w.qualified_ranges,
      expiry: w.expiry_date,
      status: qualificationLabel(welderStatus(w.expiry_date, asOf)),
    })),
    personnel: personnelRows.map((p) => {
      const party = Array.isArray(p.project_parties) ? p.project_parties[0] : p.project_parties;
      return {
        name: party?.name ?? "—",
        certification: p.certification_type,
        certNumber: p.cert_number,
        expiry: p.expiry_date,
        status: qualificationLabel(personnelStatus(p.expiry_date, asOf)),
      };
    }),
    standalone: standaloneRows.map((s) => ({
      number: s.assignment_number,
      type: s.assignment_type.replace(/_/g, " "),
      equipment: `${s.equipment_description}${s.serial_tag ? ` / ${s.serial_tag}` : ""}`,
      date: s.assignment_date,
      conclusion: (s.conclusion ?? "none").replace(/_/g, " "),
      clearance: s.cleared_at ? `Cleared${s.clearance_number ? ` ${s.clearance_number}` : ""}` : s.conclusion === "conditional_pass" ? "Clearance pending" : "Not required",
    })),
    materials: matRows.map((m) => ({
      description: m.material_description,
      heat: m.heat_number,
      batch: m.batch_number,
      po: m.po_reference,
      certificate: m.certificate_reference,
      approval: m.approval_status,
      receipt: m.receipt_status,
      supplier: m.supplier,
      quantity: m.quantity,
      releasedAt: m.released_at,
    })),
    ncrs: ncrRows.map((n) => ({
      number: n.ncr_number,
      description: n.description,
      severity: n.severity,
      status: n.status,
      closedAt: n.closed_at,
      closedByName: n.closed_by ? closerNames.get(n.closed_by) ?? null : null,
      rootCause: n.root_cause,
      correctiveAction: n.corrective_action,
      preventiveAction: n.preventive_action,
      verificationNotes: n.verification_notes,
      evidenceCount: evidenceCounts.get(n.id) ?? 0,
    })),
    punchItems: punchRows.map((p) => ({
      description: p.description,
      location: p.location,
      status: p.status,
      dueDate: p.due_date,
      closedAt: p.closed_at,
      priority: p.priority,
      source: p.source,
      responsibleParty: (Array.isArray(p.project_parties) ? p.project_parties[0] : p.project_parties)?.name ?? null,
      closingEvidence: p.closing_evidence,
      verificationNotes: p.verification_notes,
      verifiedBy: name(p.closed_by),
    })),
    nameById,
    parties: projectPartyRows.map((p) => ({ name: p.name, partyType: p.party_type })),
  };
}

/**
 * Fetches everything needed for the branded, cover-page-plus-summary Data Book PDF (R86, R108),
 * renders it via Puppeteer, uploads the result to Storage, and returns the path the caller records
 * on the job row. Mirrors renderNcrPdf.ts's structure exactly, for Data Book data instead of NCR
 * data.
 */
/** Prints the book. Shared by both passes so the page count of pass 1 matches the final PDF. */
async function printBookPdf(html: string, footerLabel: string, bookNumber: string, revisionLabel: string, contentHash: string): Promise<Buffer> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await setHtmlContentAndSettle(page, withBidi(html));
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
            <span>${escapeHtml(bookNumber)} | ${escapeHtml(revisionLabel)} | ${escapeHtml(footerLabel)}</span>
            ${sealFooterSpan(contentHash)}
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>`,
      })
    );
  } finally {
    await page.close();
  }
}

/** Reads a printed PDF back and returns the physical page each section starts on, using the
 *  invisible "§id§" markers the template puts at the top of every section, plus the page count. */
async function sectionPageMap(pdf: Buffer): Promise<{ map: Record<string, number>; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, isEvalSupported: false }).promise;
  const map: Record<string, number> = {};
  const pages = doc.numPages;
  for (let p = 1; p <= pages; p++) {
    const text = (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join("");
    for (const m of text.matchAll(/§([a-z0-9-]+)§/g)) if (map[m[1]] === undefined) map[m[1]] = p;
  }
  await doc.destroy();
  return { map, pages };
}

/** Requester must be a JAGS staff user; "system"/absent requesters (automation-queued jobs) are exempt. */
async function assertRequesterIsStaff(requestedBy: string | null | undefined): Promise<void> {
  if (!requestedBy || requestedBy === "system") return;
  const { data, error } = await supabase
    .from("users")
    .select("id, is_jags_staff")
    .eq("id", requestedBy)
    .maybeSingle<{ id: string; is_jags_staff: boolean | null }>();
  if (error) throw new Error(`Could not verify requester ${requestedBy}: ${error.message}`);
  if (!data || data.is_jags_staff !== true) {
    throw new PermanentJobError(`Requester ${requestedBy} is not a staff member; refusing to render a data book.`);
  }
}

/** Newest approved Data Book PDF filed in the vault for this book, as a bare generated-documents path. */
async function findFiledBookPath(projectId: string, bookNumber: string): Promise<string | null> {
  const { data: folder, error: folderError } = await supabase
    .from("vault_folders" as never)
    .select("id")
    .eq("project_id", projectId)
    .eq("folder_key", "certificates")
    .maybeSingle<{ id: string }>();
  if (folderError) throw new Error(`Could not resolve vault folder 'certificates': ${folderError.message}`);
  if (!folder) return null;
  const { data, error } = await supabase
    .from("vault_documents" as never)
    .select("storage_path")
    .eq("folder_id", folder.id)
    .eq("document_reference", bookNumber)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<{ storage_path: string }[]>();
  if (error) throw new Error(`Could not look up the filed data book: ${error.message}`);
  return data && data.length > 0 ? stripGeneratedPrefix(data[0].storage_path) : null;
}

const MAX_NUMBERING_PASSES = 4;

export async function renderDataBookPdf(
  payload: RenderDataBookPdfPayload & { force_regenerate?: boolean }
): Promise<{ resultStoragePath: string }> {
  const header = await loadDataBookRow(payload.data_book_id);
  await assertRequesterIsStaff(payload.requested_by);

  // An issued book is a controlled record: do not re-render it (registers/people may have changed since
  // issue) unless explicitly forced, in which case it is printed as a reprint of the same revision.
  let reprint = false;
  if (header.status === "issued") {
    if (payload.force_regenerate !== true) {
      const filed = await findFiledBookPath(header.project_id, header.book_number);
      if (filed) return { resultStoragePath: filed };
    } else {
      reprint = true;
    }
  }

  const { dataBook, data } = await buildDataBookHtml(payload.data_book_id, { reprint });
  const footerLabel = dataBookIssueLabel(dataBook.status, !!data.isConditional, reprint);
  const revLabel = bookRevLabel(data);
  // Content seal for the footer: hash of the source data (a PDF cannot print its own bytes hash; that one is stored on the certificate).
  const contentHash = sourceHash({ ...data, generatedAt: null });
  const print = (map: Record<string, number>) => printBookPdf(buildDataBookPdfHtml(data, map), footerLabel, dataBook.book_number, revLabel, contentHash);

  // Pass 1 prints without page numbers to learn where each section lands; pass 2 prints the contents
  // page and the register's "Form page" column with those real numbers. The placeholders occupy the
  // same space, so the page count is normally stable; if it shifts, further passes settle it.
  let pageMap: Record<string, number> = {};
  let pdfBuffer = await print(pageMap);
  let converged = false;
  for (let pass = 0; pass < MAX_NUMBERING_PASSES; pass++) {
    const { map: next, pages } = await sectionPageMap(pdfBuffer);
    const limit = assertBookWithinLimits(pages, pdfBuffer.length);
    if (limit) throw new PermanentJobError(limit);
    if (JSON.stringify(next) === JSON.stringify(pageMap)) {
      converged = true;
      break;
    }
    pageMap = next;
    pdfBuffer = await print(pageMap);
  }
  if (!converged) {
    console.warn(`[renderDataBookPdf] Page numbering for ${dataBook.book_number} did not converge after ${MAX_NUMBERING_PASSES} passes.`);
    throw new PermanentJobError(
      `Data book ${dataBook.book_number}: page numbering did not converge after ${MAX_NUMBERING_PASSES} passes; refusing to upload a contents page with stale page numbers.`
    );
  }

  const storagePath = buildGeneratedPath(`databooks/${dataBook.id}`, dataBook.book_number, null);

  await uploadGeneratedFile(supabase, storagePath, pdfBuffer);

  // Only an ISSUED data book is a controlled record; drafts / compiled books are download-only.
  // A forced reprint keeps the originally filed copy of this revision as the controlled one.
  if (shouldFileDataBook(dataBook.status) && !reprint) {
    try {
      await autoFileVaultDocument(supabase, {
        projectId: dataBook.project_id,
        folderKey: "certificates",
        title: `Data Book ${dataBook.book_number} — ${dataBook.title}`,
        documentReference: dataBook.book_number,
        // Vault revision follows data_books.revision so the printed "Rev n" matches the vault row.
        revision: String(dataBook.revision ?? 0),
        keepRevision: true,
        storagePath,
        fileSize: pdfBuffer.length,
        generatedBy: payload.requested_by,
      });
    } catch (err) {
      // Do not leave the uploaded object orphaned when filing fails (the retry renders to a new path).
      await removeGeneratedFile(supabase, storagePath);
      throw err;
    }
    await recordIssuedBookHash(dataBook.id, storagePath, pdfBuffer);
  }

  return { resultStoragePath: storagePath };
}

/**
 * Freezes the book that was certified (S7-03): the FIRST render of an issued book stores its path and
 * SHA-256 on the handover certificate. Later reprints never overwrite it. Best-effort - the columns
 * arrive with a migration, so an error (missing column) is logged and ignored.
 */
async function recordIssuedBookHash(dataBookId: string, storagePath: string, pdf: Buffer): Promise<void> {
  const sha = createHash("sha256").update(pdf).digest("hex");
  const { error } = await supabase
    .from("handover_certificates" as never)
    .update({ rendered_book_path: storagePath, rendered_book_sha256: sha } as never)
    .eq("data_book_id", dataBookId)
    .is("rendered_book_sha256", null);
  if (error) console.warn(`[renderDataBookPdf] Could not record the issued book hash for ${dataBookId}: ${error.message}`);
}

async function loadDataBookRow(dataBookId: string): Promise<DataBookRow> {
  const { data: dataBook, error: dataBookError } = await supabase
    .from("data_books" as never)
    .select("id, project_id, book_number, title, status, compiled_at, compiled_by, override_reason, override_by, revision, override_items")
    .eq("id", dataBookId)
    .single<DataBookRow>();

  if (dataBookError || !dataBook) {
    throw new Error(`Data book ${dataBookId} not found: ${dataBookError?.message ?? "no row"}`);
  }
  return dataBook;
}

/** Loads the book + project + every record and builds the printable HTML. Exported for local previews. */
export async function buildDataBookHtml(
  dataBookId: string,
  opts: { reprint?: boolean } = {}
): Promise<{ dataBook: DataBookRow; html: string; data: DataBookPdfData }> {
  const dataBook = await loadDataBookRow(dataBookId);

  // The handover certificate carries the issue date, issuer and whether the handover is conditional.
  let certificate: CertificateRow | null = null;
  if (dataBook.status === "issued") {
    const { data: cert, error: certError } = await supabase
      .from("handover_certificates" as never)
      .select("issued_date, issued_by, is_conditional, conditional_reason, conditional_open_items")
      .eq("data_book_id", dataBook.id)
      .maybeSingle<CertificateRow>();
    if (certError) throw new Error(`Data book render aborted — could not read the handover certificate: ${certError.message}`);
    certificate = cert;
  }
  // An issued book's registers are judged at its issue date, never "now".
  const asOf = dataBook.status === "issued" ? registerAsOf(certificate?.issued_date ?? dataBook.compiled_at) : registerAsOf(null);

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
    computeDataBookReadinessForWorker(dataBook.project_id, asOf),
    computeDataBookDisciplineBreakdownForWorker(dataBook.project_id),
    gatherDataBookContent(
      dataBook.project_id,
      asOf,
      [dataBook.compiled_by, dataBook.override_by, certificate?.issued_by].filter((v): v is string => !!v)
    ),
  ]);

  const overrideCategories = normaliseOverrideItems(dataBook.override_items);
  const conditionalCategories = overrideCategories.length > 0 ? overrideCategories : normaliseOverrideItems(certificate?.conditional_open_items);

  const templateData: DataBookPdfData = {
    bookNumber: dataBook.book_number,
    bookRevision: dataBook.revision ?? 0,
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
    overrideReason: dataBook.override_reason ?? certificate?.conditional_reason ?? null,
    overrideBy: dataBook.override_by ? (content.nameById.get(dataBook.override_by) ?? null) : null,
    isConditional: dataBook.status === "issued" && certificate?.is_conditional === true,
    overrideCategories: conditionalCategories,
    issuedDate: certificate?.issued_date ?? null,
    issuedByName: certificate?.issued_by ? (content.nameById.get(certificate.issued_by) ?? null) : null,
    reprint: opts.reprint === true,
    siteLocation: project?.site_location ?? null,
    parties: content.parties,
    itps: content.itps,
    calibrations: content.calibrations,
    welders: content.welders,
    materials: content.materials,
    personnel: content.personnel,
    standalone: content.standalone,
    ncrs: content.ncrs,
    punchItems: content.punchItems,
    generatedAt: new Date(),
    branding: await getOrgBranding(supabase, project?.organization_id),
  };

  const html = buildDataBookPdfHtml(templateData);
  return { dataBook, html, data: templateData };
}
