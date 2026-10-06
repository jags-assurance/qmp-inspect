import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PUNCH_LIST_ITEMS_TABLE } from "@/lib/punch-list/types";
import { CHECKLIST_TEMPLATES_TABLE } from "@/lib/checklists/db-types";
import {
  CALIBRATION_REGISTER_TABLE,
  MATERIAL_REGISTER_TABLE,
  WELDER_QUALIFICATION_REGISTER_TABLE,
} from "@/lib/registers/types";

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
  materialRegister: ReadinessCategory;
  ncrs: ReadinessCategory;
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
   * a mystery number. Rounded to the nearest whole percent.
   */
  overallPercentage: number;
  /** True only when every gating category is 100% AND there are zero open punch items — the R86 compile gate. */
  isReady: boolean;
}

function toCategory(label: string, ready: number, total: number): ReadinessCategory {
  return { label, ready, total, percentage: total === 0 ? 100 : Math.round((ready / total) * 100) };
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
    // revision_needs_approval: an issued ITP whose latest revision hasn't been re-approved isn't "ready".
    supabase.from("itps" as never).select("id, status, revision_needs_approval").eq("project_id" as never, projectId as never).returns<
      { id: string; status: string; revision_needs_approval: boolean }[]
    >(),
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
    // Observations are advisory notes, not nonconformances — they must not hold the book at "not ready".
    supabase.from("ncrs" as any).select("id, status").eq("project_id", projectId).neq("severity", "observation").returns<
      { id: string; status: string }[]
    >(),
    supabase
      .from(PUNCH_LIST_ITEMS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .neq("status", "closed"),
    supabase.from(CALIBRATION_REGISTER_TABLE).select("id, status").eq("project_id", projectId).returns<
      { id: string; status: string }[]
    >(),
    supabase.from(WELDER_QUALIFICATION_REGISTER_TABLE).select("id, status").eq("project_id", projectId).returns<
      { id: string; status: string }[]
    >(),
    supabase
      .from(MATERIAL_REGISTER_TABLE)
      .select("id, approval_status, receipt_status")
      .eq("project_id", projectId)
      .returns<{ id: string; approval_status: string; receipt_status: string }[]>(),
    supabase.from("data_books" as any).select("id").eq("project_id", projectId).eq("status", "issued").returns<
      { id: string }[]
    >(),
  ]);

  const itpTotal = itps?.length ?? 0;
  const itpReady = (itps ?? []).filter((itp) => (itp.status === "approved" || itp.status === "client_accepted") && !itp.revision_needs_approval).length;

  const recordTotal = inspectionRecords?.length ?? 0;
  const recordReady = (inspectionRecords ?? []).filter((record) =>
    Array.isArray(record.irns) ? record.irns.length > 0 : record.irns !== null
  ).length;

  // Checklists: every checklist that has produced a COMPLETED inspection (an overall_result has
  // been recorded) counts as ready — matches "Completed checklists: Required N, Provided M" in the
  // sample layout, distinct from "Inspection records with an issued IRN" above (a checklist can be
  // fully answered and still be short its IRN, e.g. while a fail is worked through an NCR).
  // Only issued ITPs: a draft or under-review ITP's checklists aren't in the book yet (the ITP category above already blocks readiness for them).
  const { data: itpIdsForProject } = await supabase.from("itps").select("id").eq("project_id", projectId).in("status", ["approved", "client_accepted"]);
  const itpIds = (itpIdsForProject ?? []).map((i) => i.id);
  let checklistTotal = 0;
  let checklistReady = 0;
  if (itpIds.length > 0) {
    const { data: sections } = await supabase.from("itp_sections").select("id").in("itp_id", itpIds);
    const sectionIds = (sections ?? []).map((s) => s.id);
    if (sectionIds.length > 0) {
      const { data: items } = await supabase
        .from("itp_items")
        .select("id")
        .in("section_id", sectionIds)
        .eq("evidence_type", 1);
      const itemIds = (items ?? []).map((i) => i.id);
      if (itemIds.length > 0) {
        const { data: templates } = await supabase
          .from(CHECKLIST_TEMPLATES_TABLE)
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

  // Registers: "ready" means usable/in-date, not merely "a row exists" — an expired calibration or
  // welder qualification, or a material still on hold/not yet released, is exactly the kind of thing
  // that should hold up a data book, matching the registers' own protective status logic
  // (lib/registers/refresh.ts, lib/registers/verify.ts) rather than inventing a separate rule here.
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
  const handoverCertificateCategory = toCategory(
    "Handover certificate issued",
    (issuedDataBooks?.length ?? 0) > 0 ? 1 : 0,
    1
  );

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
    itps: itpsCategory,
    inspectionRecords: inspectionRecordsCategory,
    checklists: checklistsCategory,
    calibrationRegister: calibrationCategory,
    welderRegister: welderCategory,
    materialRegister: materialCategory,
    ncrs: ncrsCategory,
    handoverCertificate: handoverCertificateCategory,
    openPunchItems: openPunchItemCount,
    overallPercentage,
    isReady: gatingCategories.every((c) => c.percentage === 100) && openPunchItemCount === 0,
  };
}
