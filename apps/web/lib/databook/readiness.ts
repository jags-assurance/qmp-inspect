import { createSupabaseServerClient } from "@/lib/supabase/server";
import { untypedFrom } from "@/lib/supabase/untyped";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { CHECKLIST_TEMPLATES_TABLE } from "@/lib/checklists/db-types";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
} from "@/lib/registers/types";
import { strictPercentage, isCategoryComplete } from "./readiness-math";
import { fetchAllRows, fetchInChunks } from "./helpers";
import { isRegisterRowCounted, type RegisterRowMeta } from "@/lib/registers/lifecycle";
import { isTerminalItpStatus } from "@/lib/itps/lifecycle";
import { computeCalibrationStatus, computePersonnelCertificationStatus, computeWelderStatus } from "@/lib/registers/status";

export interface ReadinessCategory {
  label: string;
  ready: number;
  total: number;
  /** 100 when total is 0 — an empty category has nothing outstanding, so it doesn't hold up compilation. */
  percentage: number;
}

export interface DataBookReadiness {
  itps: ReadinessCategory;
  inspectionRecords: ReadinessCategory;
  checklists: ReadinessCategory;
  calibrationRegister: ReadinessCategory;
  welderRegister: ReadinessCategory;
  personnelRegister: ReadinessCategory;
  materialRegister: ReadinessCategory;
  /** Completed FAT / pre-shipment / other standalone assignments: Pass, or Conditional Pass with clearance issued. */
  standaloneAssignments: ReadinessCategory;
  ncrs: ReadinessCategory;
  /** Checklist-driven ITP activities whose latest completed inspection passed (an activity with no inspection at all is NOT ready). */
  activitiesExecuted: ReadinessCategory;
  /** Hold and Witness sign-offs on approved ITPs that are signed off (Witness may also be "proceeded after notice"). */
  holdPoints: ReadinessCategory;
  /** Informational only — a handover certificate is the OUTCOME of compiling, not a precondition for
   *  it, so this is excluded from isReady/overallPercentage below (see the client sample pack's own
   *  data-book layout, where "Handover certificate" is the last section, gated by everything above
   *  it rather than gating them). */
  handoverCertificate: ReadinessCategory;
  openPunchItems: number;
  /**
   * Sum of every gating category's `ready` count divided by the sum of every gating category's
   * `total` count (handoverCertificate excluded — see above) — a single, disclosed formula, not an
   * average of percentages (which would weight a 1-item category the same as a 40-item one) and not
   * a mystery number. Floored (never rounds up to 100 unless everything is ready).
   */
  overallPercentage: number;
  /** True only when every gating category is 100% AND there are zero open punch items — the R86 compile gate. */
  isReady: boolean;
}

interface InspectionRecordRow {
  id: string;
  itp_item_id: string | null;
  created_at: string;
  checklist_template_id: string | null;
  overall_result: string | null;
  irns: { id: string; voided_at: string | null }[] | { id: string; voided_at: string | null } | null;
}

/**
 * E2: register rows for readiness are read WITH verified_at / lifecycle_status and filtered through
 * isRegisterRowCounted (same rule as the inspection soft-stop): unverified (contributor-entered, not yet
 * verified by JAGS staff) and superseded / retired / withdrawn rows are ignored. If those columns are not in
 * the database yet (migration 20261103000100 unapplied) the read is repeated without them, as before.
 */
export async function fetchCountedRegisterRows<T extends object>(
  columns: string,
  page: (select: string, from: number, to: number) => PromiseLike<{ data: unknown[] | null; error?: unknown }>
): Promise<(T & RegisterRowMeta)[]> {
  const read = (select: string) => fetchAllRows<T & RegisterRowMeta>((from, to) => page(select, from, to) as never);
  let rows: (T & RegisterRowMeta)[];
  try {
    rows = await read(`${columns}, verified_at, lifecycle_status`);
  } catch (err) {
    if (!/does not exist|schema cache/i.test(err instanceof Error ? err.message : String(err))) throw err;
    rows = await read(columns);
  }
  return rows.filter(isRegisterRowCounted);
}

function toCategory(label: string, ready: number, total: number): ReadinessCategory {
  return { label, ready, total, percentage: strictPercentage(ready, total) };
}

/**
 * Live readiness calculation for a project's Data Book (R86): computed from existing tables on
 * every call rather than stored, so it always reflects the project's current state. Expanded from
 * the original 3 categories (ITPs/inspection records/NCRs) to cover every category a client-facing
 * data-book completeness index needs to show a real Required-vs-Provided count for: checklists,
 * calibration/welder/material registers, and (informationally) the handover certificate itself.
 * "Cover/index" and "as-built drawings/O&M manuals" sections some sample layouts show are
 * deliberately NOT modelled here — there's no dedicated tracked entity for either in this schema
 * (as-builts are just vault documents with no reserved category convention), and fabricating a
 * category with no real backing data would be worse than omitting it.
 */
export async function computeDataBookReadiness(projectId: string): Promise<DataBookReadiness> {
  const supabase = await createSupabaseServerClient();

  // Every list query below is paginated with .range() loops (fetchAllRows) so a project with more
  // than 1000 rows is never silently truncated, and id-list lookups are chunked to 200 ids per
  // request (fetchInChunks). KEEP IN SYNC with worker/src/jobs/renderDataBookPdf.ts - the worker must
  // paginate the same way and apply the same severity filter, or the PDF and this page disagree.
  const [
    itps,
    inspectionRecords,
    ncrs,
    { count: openPunchItems, error: punchError },
    calibrationRows,
    welderRows,
    materialRows,
    issuedDataBooks,
    personnelRows,
    standaloneRows,
  ] = await Promise.all([
    // revision_needs_approval: an issued ITP whose latest revision hasn't been re-approved isn't "ready".
    fetchAllRows<{ id: string; status: string; revision_needs_approval: boolean }>((from, to) =>
      supabase
        .from("itps" as never)
        .select("id, status, revision_needs_approval")
        .eq("project_id" as never, projectId as never)
        .order("id" as never)
        .range(from, to)
        .returns<{ id: string; status: string; revision_needs_approval: boolean }[]>()
    ),
    fetchAllRows<InspectionRecordRow>((from, to) =>
      supabase
        .from("inspection_records")
        .select("id, itp_item_id, created_at, checklist_template_id, overall_result, irns(id, voided_at)")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to)
        .returns<InspectionRecordRow[]>()
    ),
    // Observations are advisory notes, not nonconformances — they must not hold the book at "not ready".
    // .or() keeps rows whose severity is NULL (a plain .neq would drop them in SQL).
    fetchAllRows<{ id: string; status: string }>((from, to) =>
      untypedFrom(supabase, "ncrs")
        .select("id, status")
        .eq("project_id", projectId)
        .or("severity.is.null,severity.neq.observation")
        .order("id")
        .range(from, to)
        .returns<{ id: string; status: string }[]>()
    ),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .neq("status", "closed"),
    fetchCountedRegisterRows<{ id: string; due_date: string }>("id, due_date", (select, from, to) =>
      untypedFrom(supabase, CALIBRATION_REGISTER_TABLE).select(select).eq("project_id", projectId).order("id").range(from, to)
    ),
    fetchCountedRegisterRows<{ id: string; expiry_date: string }>("id, expiry_date", (select, from, to) =>
      untypedFrom(supabase, WELDER_QUALIFICATION_REGISTER_TABLE).select(select).eq("project_id", projectId).order("id").range(from, to)
    ),
    fetchCountedRegisterRows<{ id: string; approval_status: string; receipt_status: string }>("id, approval_status, receipt_status", (select, from, to) =>
      untypedFrom(supabase, MATERIAL_REGISTER_TABLE).select(select).eq("project_id", projectId).order("id").range(from, to)
    ),
    fetchAllRows<{ id: string }>((from, to) =>
      untypedFrom(supabase, "data_books").select("id").eq("project_id", projectId).eq("status", "issued").order("id").range(from, to).returns<{ id: string }[]>()
    ),
    fetchCountedRegisterRows<{ id: string; expiry_date: string }>("id, expiry_date", (select, from, to) =>
      untypedFrom(supabase, "personnel_certifications").select(select).eq("project_id", projectId).order("id").range(from, to)
    ),
    fetchAllRows<{ id: string; status: string; conclusion: string | null; cleared_at: string | null }>((from, to) =>
      supabase
        .from("standalone_assignments" as never)
        .select("id, status, conclusion, cleared_at")
        .eq("project_id" as never, projectId as never)
        .order("id" as never)
        .range(from, to)
        .returns<{ id: string; status: string; conclusion: string | null; cleared_at: string | null }[]>()
    ),
  ]);

  // A failed count must not read as "0 open punch items" (fail closed).
  if (punchError) throw new Error(`Data Book query failed: ${punchError.message}`);

  // Superseded / withdrawn ITPs are kept for the record but no longer count toward readiness.
  const liveItps = itps.filter((itp) => !isTerminalItpStatus(itp.status));
  const itpTotal = liveItps.length;
  const itpReady = liveItps.filter((itp) => (itp.status === "approved" || itp.status === "client_accepted") && !itp.revision_needs_approval).length;

  // "Inspection records with an issued IRN" denominator: ONLY the latest COMPLETED record per itp_item
  // (overall_result not null), and only when that latest result is pass/partial. Drafts (no result)
  // never count, and a fail that was re-inspected is superseded by the newer record.
  // KEEP IN SYNC with worker/src/jobs/renderDataBookPdf.ts - it must apply this exact same rule.
  const latestByItem = new Map<string, InspectionRecordRow>();
  for (const r of inspectionRecords) {
    if (!r.overall_result) continue;
    const key = r.itp_item_id ?? r.id;
    const cur = latestByItem.get(key);
    if (!cur || r.created_at > cur.created_at) latestByItem.set(key, r);
  }
  const countedRecords = [...latestByItem.values()].filter((r) => r.overall_result === "pass" || r.overall_result === "partial");
  const recordTotal = countedRecords.length;
  // Voided IRNs do not count as issued.
  const recordReady = countedRecords.filter((record) =>
    (Array.isArray(record.irns) ? record.irns : record.irns ? [record.irns] : []).some((i) => !i.voided_at)
  ).length;

  // Checklists: every checklist that has produced a COMPLETED inspection (an overall_result has
  // been recorded) counts as ready — matches "Completed checklists: Required N, Provided M" in the
  // sample layout, distinct from "Inspection records with an issued IRN" above (a checklist can be
  // fully answered and still be short its IRN, e.g. while a fail is worked through an NCR).
  // Only issued ITPs: a draft or under-review ITP's checklists aren't in the book yet (the ITP category above already blocks readiness for them).
  const itpIds = await fetchAllRows<{ id: string }>((from, to) =>
    supabase.from("itps").select("id").eq("project_id", projectId).in("status", ["approved", "client_accepted"]).order("id").range(from, to).returns<{ id: string }[]>()
  ).then((rows) => rows.map((i) => i.id));
  let checklistTotal = 0;
  let checklistReady = 0;
  let activityTotal = 0;
  let activityReady = 0;
  let holdTotal = 0;
  let holdReady = 0;
  if (itpIds.length > 0) {
    const sections = await fetchInChunks(itpIds, (ids) =>
      fetchAllRows<{ id: string }>((from, to) => supabase.from("itp_sections").select("id").in("itp_id", ids).order("id").range(from, to).returns<{ id: string }[]>())
    );
    const sectionIds = sections.map((s) => s.id);
    if (sectionIds.length > 0) {
      const allItems = await fetchInChunks(sectionIds, (ids) =>
        fetchAllRows<{ id: string; evidence_type: number }>((from, to) =>
          supabase.from("itp_items").select("id, evidence_type").in("section_id", ids).order("id").range(from, to).returns<{ id: string; evidence_type: number }[]>()
        )
      );
      const items = allItems.filter((i) => i.evidence_type === 1);
      const itemIds = items.map((i) => i.id);

      // Execution gates (S7-06): readiness used to be derived only from records that EXIST, so a
      // project with half its activities never inspected read as 100%. KEEP IN SYNC with the worker.
      activityTotal = items.length;
      activityReady = items.filter((i) => {
        const latest = latestByItem.get(i.id);
        return latest && (latest.overall_result === "pass" || latest.overall_result === "partial");
      }).length;
      const holds = await fetchInChunks(allItems.map((i) => i.id), (ids) =>
        fetchAllRows<{ id: string; status: string; intervention: string }>((from, to) =>
          supabase
            .from("activity_signoff_progress")
            .select("id, status, intervention")
            .in("itp_item_id", ids)
            .in("intervention", ["H", "W"])
            .order("id")
            .range(from, to)
            .returns<{ id: string; status: string; intervention: string }[]>()
        )
      );
      holdTotal = holds.length;
      holdReady = holds.filter((h) => h.status === "signed_off" || (h.intervention === "W" && h.status === "proceeded_no_response")).length;

      if (itemIds.length > 0) {
        const templates = await fetchInChunks(itemIds, (ids) =>
          fetchAllRows<{ id: string }>((from, to) =>
            supabase.from(CHECKLIST_TEMPLATES_TABLE).select("id").in("itp_item_id", ids).order("id").range(from, to).returns<{ id: string }[]>()
          )
        );
        checklistTotal = templates.length;
        const completedTemplateIds = new Set(
          inspectionRecords
            .filter((r) => r.checklist_template_id && r.overall_result !== null)
            .map((r) => r.checklist_template_id as string)
        );
        checklistReady = templates.filter((t) => completedTemplateIds.has(t.id)).length;
      }
    }
  }

  const ncrTotal = ncrs.length;
  const ncrReady = ncrs.filter((ncr) => ncr.status === "closed").length;

  // Registers: "ready" means usable/in-date, not merely "a row exists" — an expired calibration or
  // welder qualification, or a material still on hold/not yet released, is exactly the kind of thing
  // that should hold up a data book, matching the registers' own protective status logic
  // (lib/registers/refresh.ts, lib/registers/verify.ts) rather than inventing a separate rule here.
  const calibrationTotal = calibrationRows.length;
  const calibrationReady = calibrationRows.filter((r) => computeCalibrationStatus(r.due_date) !== "expired").length;

  const welderTotal = welderRows.length;
  const welderReady = welderRows.filter((r) => computeWelderStatus(r.expiry_date) !== "expired").length;

  const personnelTotal = personnelRows.length;
  const personnelReady = personnelRows.filter((r) => computePersonnelCertificationStatus(r.expiry_date) !== "expired").length;

  const standaloneTotal = standaloneRows.length;
  const standaloneReady = standaloneRows.filter(
    (r) => r.status === "completed" && (r.conclusion === "pass" || (r.conclusion === "conditional_pass" && !!r.cleared_at))
  ).length;

  const materialTotal = materialRows.length;
  const materialReady = materialRows.filter(
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
  const handoverCertificateCategory = toCategory(
    "Handover certificate issued",
    issuedDataBooks.length > 0 ? 1 : 0,
    1
  );

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
  const overallPercentage = strictPercentage(totalReady, totalRequired);

  const openPunchItemCount = openPunchItems ?? 0;

  return {
    itps: itpsCategory,
    inspectionRecords: inspectionRecordsCategory,
    checklists: checklistsCategory,
    calibrationRegister: calibrationCategory,
    welderRegister: welderCategory,
    personnelRegister: personnelCategory,
    materialRegister: materialCategory,
    standaloneAssignments: standaloneCategory,
    ncrs: ncrsCategory,
    activitiesExecuted: activitiesCategory,
    holdPoints: holdPointsCategory,
    handoverCertificate: handoverCertificateCategory,
    openPunchItems: openPunchItemCount,
    overallPercentage,
    isReady: gatingCategories.every(isCategoryComplete) && openPunchItemCount === 0,
  };
}
