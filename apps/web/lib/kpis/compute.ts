// Client KPI Dashboard computations (Reqs R89-R90).
//
// Every query here is explicitly filtered by the caller-supplied `projectId`, on top of (not
// instead of) the `has_org_access` RLS policies already enforced on every table read here
// (projects/itps/itp_items/inspection_records/ncrs/activity_signoff_progress) — see the file
// header on 20260909210100_phase0_rls_policies.sql. That double scoping is deliberate: this
// dashboard is client-facing and must never surface another organisation's data or anything
// resembling the internal JAGS command centre (costs/margins), even if a query were ever copied
// and its WHERE clause dropped by mistake later. Nothing here reads or exposes cost/margin data —
// no such columns exist on any table this file touches.
//
// `activity_signoff_progress` isn't in the generated Database type yet (added by
// supabase/migrations/20260910000000_phase1_signoff_chain.sql after the last type generation), so
// it's read through the same `"table" as any` escape hatch as ACTIVITY_SIGNOFF_PROGRESS_TABLE in
// lib/signoff/db-types.ts — every row is still typed via `.returns<T>()`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVITY_SIGNOFF_PROGRESS_TABLE, type SignoffStatus } from "@/lib/signoff/db-types";
import { NCRS_TABLE, type NcrRow } from "@/lib/ncrs/types";

export interface OpenNcrItem {
  kind: "ncr";
  id: string;
  reference: string;
  description: string;
  status: string;
  createdAt: string;
}

export interface FailedInspectionItem {
  kind: "inspection";
  id: string;
  reference: string;
  description: string;
  status: string;
  createdAt: string;
}

export type OpenItem = OpenNcrItem | FailedInspectionItem;

export interface ProjectKpis {
  /** % of itp_items whose earliest inspection_record (by created_at) passed on the first attempt. */
  firstTimePassRate: number | null;
  firstTimePassCounts: { firstAttempts: number; firstTimePasses: number };

  /**
   * Average hours between an ITP's approval and completion of inspections against its Hold-type
   * (H) items. Precise when sign-off timestamps are available (signed_off_at - notified_at on the
   * H rows in activity_signoff_progress); falls back to the itp.updated_at (a proxy for approval,
   * since itps has no dedicated approved_at column) -> inspection_records.created_at gap for Hold
   * items with no notified/signed-off pair yet.
   */
  holdPointTurnaroundHours: number | null;
  holdPointTurnaroundSource: "signoff_chain" | "approval_proxy" | null;

  /** Average hours between ncrs.created_at and ncrs.closed_at for closed NCRs on this project. */
  ncrCloseOutHours: number | null;
  ncrCloseOutCount: number;

  /**
   * Data-book readiness proxy: (approved + client_accepted ITPs) / total ITPs. Swap for the real
   * readiness calculation once apps/web/lib/databook/readiness.ts exists (it did not exist at the
   * time this was written) — see this feature's final report.
   */
  dataBookReadiness: number | null;
  dataBookReadinessIsProxy: true;

  /** completed = inspection_records with a non-null overall_result; planned = evidence_type = 1 itp_items on approved-or-later ITPs. */
  inspectionsCompleted: number;
  inspectionsPlanned: number;
  inspectionsCompletionRate: number | null;

  /** % of the project's ITPs with status = 'client_accepted'. */
  itpCompletionRate: number | null;
  itpCompletionCounts: { clientAccepted: number; total: number };

  openItems: OpenItem[];
}

export interface QualityByPartyRow {
  partyName: string;
  percentage: number;
}

/**
 * Ranks each project party by their sign-off completion rate: signed-off activity_signoff_progress
 * rows / total rows for that party, scoped to this project via
 * activity_signoff_progress -> itp_items -> itp_sections -> itps (itps.project_id = projectId).
 * Parties with zero rows for this project are omitted entirely (never shown as 0/0 = 0%).
 */
export async function computeQualityByParty(supabase: SupabaseClient, projectId: string): Promise<QualityByPartyRow[]> {
  const { data: itps } = await supabase.from("itps").select("id").eq("project_id", projectId).returns<{ id: string }[]>();
  const itpIds = (itps ?? []).map((itp) => itp.id);
  if (itpIds.length === 0) return [];

  const { data: sections } = await supabase
    .from("itp_sections")
    .select("id")
    .in("itp_id", itpIds)
    .returns<{ id: string }[]>();
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const { data: items } = await supabase
    .from("itp_items")
    .select("id")
    .in("section_id", sectionIds)
    .returns<{ id: string }[]>();
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return [];

  const { data: signoffs } = await supabase
    .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
    .select("project_party_id, status")
    .in("itp_item_id", itemIds)
    .returns<{ project_party_id: string; status: SignoffStatus }[]>();
  const rows = signoffs ?? [];
  if (rows.length === 0) return [];

  const totalsByParty = new Map<string, { total: number; signedOff: number }>();
  for (const row of rows) {
    const entry = totalsByParty.get(row.project_party_id) ?? { total: 0, signedOff: 0 };
    entry.total += 1;
    if (row.status === "signed_off") entry.signedOff += 1;
    totalsByParty.set(row.project_party_id, entry);
  }

  const partyIds = [...totalsByParty.keys()];
  const { data: parties } = await supabase
    .from("project_parties")
    .select("id, name")
    .in("id", partyIds)
    .returns<{ id: string; name: string }[]>();
  const nameById = new Map((parties ?? []).map((p) => [p.id, p.name]));

  return partyIds
    .map((partyId) => ({
      partyName: nameById.get(partyId) ?? "Unknown party",
      percentage: Math.round((totalsByParty.get(partyId)!.signedOff / totalsByParty.get(partyId)!.total) * 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);
}

export interface DisciplinePassRateRow {
  disciplineCode: string;
  disciplineName: string;
  firstAttempts: number;
  firstTimePasses: number;
  rate: number | null;
}

/**
 * First-time pass rate broken out per discipline (Piping, Welding & NDT, Instrumentation, ...),
 * instead of computeProjectKpis's single project-wide number — a multi-discipline project (e.g. an
 * oil & gas platform upgrade) can have one discipline driving quality issues while others are clean,
 * and a single blended rate hides that. Same "first attempt per item" logic as
 * computeProjectKpis.firstTimePassRate, just grouped by itp_items.discipline_id instead of summed
 * across the whole project. Disciplines with zero first attempts are omitted entirely, matching
 * computeQualityByParty's "never show 0/0" convention.
 */
export async function computeFirstTimePassRateByDiscipline(
  supabase: SupabaseClient,
  projectId: string
): Promise<DisciplinePassRateRow[]> {
  const { data: itps } = await supabase.from("itps").select("id").eq("project_id", projectId).returns<{ id: string }[]>();
  const itpIds = (itps ?? []).map((itp) => itp.id);
  if (itpIds.length === 0) return [];

  const { data: sections } = await supabase.from("itp_sections").select("id").in("itp_id", itpIds).returns<{ id: string }[]>();
  const sectionIds = (sections ?? []).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const { data: items } = await supabase
    .from("itp_items")
    .select("id, discipline_id")
    .in("section_id", sectionIds)
    .not("discipline_id", "is", null)
    .returns<{ id: string; discipline_id: string }[]>();
  const itemIds = (items ?? []).map((i) => i.id);
  if (itemIds.length === 0) return [];

  const disciplineByItem = new Map(items!.map((i) => [i.id, i.discipline_id]));

  const { data: records } = await supabase
    .from("inspection_records")
    .select("itp_item_id, overall_result, created_at")
    .in("itp_item_id", itemIds)
    .order("created_at", { ascending: true })
    .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string }[]>();

  const firstAttemptByItem = new Map<string, (typeof records extends (infer T)[] | null ? T : never)>();
  for (const record of records ?? []) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
  }

  const totalsByDiscipline = new Map<string, { firstAttempts: number; firstTimePasses: number }>();
  for (const [itemId, record] of firstAttemptByItem) {
    if (record.overall_result === null) continue;
    const disciplineId = disciplineByItem.get(itemId);
    if (!disciplineId) continue;
    const entry = totalsByDiscipline.get(disciplineId) ?? { firstAttempts: 0, firstTimePasses: 0 };
    entry.firstAttempts += 1;
    if (record.overall_result === "pass") entry.firstTimePasses += 1;
    totalsByDiscipline.set(disciplineId, entry);
  }

  if (totalsByDiscipline.size === 0) return [];

  const { data: disciplines } = await supabase
    .from("master_disciplines")
    .select("id, code, name")
    .in("id", [...totalsByDiscipline.keys()])
    .returns<{ id: string; code: string; name: string }[]>();
  const disciplineById = new Map((disciplines ?? []).map((d) => [d.id, d]));

  return [...totalsByDiscipline.entries()]
    .map(([disciplineId, counts]) => {
      const discipline = disciplineById.get(disciplineId);
      return {
        disciplineCode: discipline?.code ?? "—",
        disciplineName: discipline?.name ?? "Unknown discipline",
        firstAttempts: counts.firstAttempts,
        firstTimePasses: counts.firstTimePasses,
        rate: counts.firstAttempts > 0 ? Math.round((counts.firstTimePasses / counts.firstAttempts) * 100) : null,
      };
    })
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60);
}

export async function computeProjectKpis(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectKpis> {
  const [itpsResult, ncrsResult] = await Promise.all([
    supabase
      .from("itps")
      .select("id, status, updated_at")
      .eq("project_id", projectId)
      .returns<{ id: string; status: "draft" | "under_review" | "approved" | "client_accepted"; updated_at: string }[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("id, ncr_number, description, status, created_at, closed_at")
      .eq("project_id", projectId)
      .returns<Pick<NcrRow, "id" | "ncr_number" | "description" | "status" | "created_at" | "closed_at">[]>(),
  ]);

  const itps = itpsResult.data ?? [];
  const ncrs = ncrsResult.data ?? [];
  const itpIds = itps.map((itp) => itp.id);
  const approvedOrAcceptedItpIds = itps
    .filter((itp) => itp.status === "approved" || itp.status === "client_accepted")
    .map((itp) => itp.id);

  const itpSectionsResult =
    itpIds.length > 0
      ? await supabase.from("itp_sections").select("id, itp_id").in("itp_id", itpIds).returns<{ id: string; itp_id: string }[]>()
      : { data: [] as { id: string; itp_id: string }[] };
  const sections = itpSectionsResult.data ?? [];
  const sectionIds = sections.map((s) => s.id);
  const sectionToItp = new Map(sections.map((s) => [s.id, s.itp_id]));

  const itpItemsResult =
    sectionIds.length > 0
      ? await supabase
          .from("itp_items")
          .select("id, section_id, evidence_type")
          .in("section_id", sectionIds)
          .returns<{ id: string; section_id: string; evidence_type: 1 | 2 | 3 }[]>()
      : { data: [] as { id: string; section_id: string; evidence_type: 1 | 2 | 3 }[] };
  const itpItems = itpItemsResult.data ?? [];
  const itemToItp = new Map(itpItems.map((item) => [item.id, sectionToItp.get(item.section_id) ?? null]));

  const [inspectionRecordsResult, holdSignoffsResult] = await Promise.all([
    supabase
      .from("inspection_records")
      .select("id, record_number, activity, itp_item_id, overall_result, notes, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .returns<
        {
          id: string;
          record_number: string;
          activity: string;
          itp_item_id: string;
          overall_result: "pass" | "fail" | "partial" | null;
          notes: string | null;
          created_at: string;
        }[]
      >(),
    itpItems.length > 0
      ? supabase
          .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
          .select("itp_item_id, intervention, notified_at, signed_off_at")
          .eq("intervention", "H")
          .in(
            "itp_item_id",
            itpItems.map((item) => item.id)
          )
          .returns<{ itp_item_id: string; intervention: "H"; notified_at: string | null; signed_off_at: string | null }[]>()
      : Promise.resolve({ data: [] as { itp_item_id: string; intervention: "H"; notified_at: string | null; signed_off_at: string | null }[] }),
  ]);

  const inspectionRecords = inspectionRecordsResult.data ?? [];
  const holdSignoffs = holdSignoffsResult.data ?? [];

  // --- 1. First-time pass rate ---
  const firstAttemptByItem = new Map<string, (typeof inspectionRecords)[number]>();
  for (const record of inspectionRecords) {
    if (!firstAttemptByItem.has(record.itp_item_id)) {
      firstAttemptByItem.set(record.itp_item_id, record);
    }
  }
  const firstAttempts = [...firstAttemptByItem.values()].filter((r) => r.overall_result !== null);
  const firstTimePasses = firstAttempts.filter((r) => r.overall_result === "pass");
  const firstTimePassRate = firstAttempts.length > 0 ? (firstTimePasses.length / firstAttempts.length) * 100 : null;

  // --- 2. Hold-point turnaround ---
  const holdItemIds = new Set(itpItems.filter((item) => holdSignoffs.some((s) => s.itp_item_id === item.id)).map((i) => i.id));
  const signoffDurations = holdSignoffs
    .filter((s) => s.notified_at && s.signed_off_at)
    .map((s) => hoursBetween(s.notified_at as string, s.signed_off_at as string));

  let holdPointTurnaroundHours: number | null = null;
  let holdPointTurnaroundSource: ProjectKpis["holdPointTurnaroundSource"] = null;
  if (signoffDurations.length > 0) {
    holdPointTurnaroundHours = average(signoffDurations);
    holdPointTurnaroundSource = "signoff_chain";
  } else {
    const itpUpdatedAt = new Map(itps.map((itp) => [itp.id, itp.updated_at]));
    const proxyDurations = inspectionRecords
      .filter((record) => {
        const parentItpId = itemToItp.get(record.itp_item_id);
        return (
          parentItpId &&
          approvedOrAcceptedItpIds.includes(parentItpId) &&
          (holdItemIds.size === 0 ? itpItems.some((i) => i.id === record.itp_item_id) : holdItemIds.has(record.itp_item_id)) &&
          record.overall_result !== null
        );
      })
      .map((record) => {
        const parentItpId = itemToItp.get(record.itp_item_id) as string;
        const approvedAt = itpUpdatedAt.get(parentItpId);
        return approvedAt ? hoursBetween(approvedAt, record.created_at) : null;
      })
      .filter((h): h is number => h !== null && h >= 0);
    if (proxyDurations.length > 0) {
      holdPointTurnaroundHours = average(proxyDurations);
      holdPointTurnaroundSource = "approval_proxy";
    }
  }

  // --- 3. NCR close-out time ---
  const closedNcrs = ncrs.filter((ncr) => ncr.status === "closed" && ncr.closed_at);
  const ncrDurations = closedNcrs.map((ncr) => hoursBetween(ncr.created_at, ncr.closed_at as string));
  const ncrCloseOutHours = average(ncrDurations);

  // --- 4. Data-book readiness (proxy) ---
  const acceptedOrApprovedCount = itps.filter((itp) => itp.status === "approved" || itp.status === "client_accepted").length;
  const dataBookReadiness = itps.length > 0 ? (acceptedOrApprovedCount / itps.length) * 100 : null;

  // --- 5. Inspections completed vs planned ---
  const inspectionsCompleted = inspectionRecords.filter((r) => r.overall_result !== null).length;
  const inspectionsPlanned = itpItems.filter((item) => {
    const parentItpId = sectionToItp.get(item.section_id);
    return item.evidence_type === 1 && parentItpId && approvedOrAcceptedItpIds.includes(parentItpId);
  }).length;
  const inspectionsCompletionRate = inspectionsPlanned > 0 ? (inspectionsCompleted / inspectionsPlanned) * 100 : null;

  // --- 6. ITP completion % ---
  const clientAcceptedCount = itps.filter((itp) => itp.status === "client_accepted").length;
  const itpCompletionRate = itps.length > 0 ? (clientAcceptedCount / itps.length) * 100 : null;

  // --- Open items table ---
  const openNcrItems: OpenNcrItem[] = ncrs
    .filter((ncr) => ncr.status !== "closed")
    .map((ncr) => ({
      kind: "ncr",
      id: ncr.id,
      reference: ncr.ncr_number,
      description: ncr.description,
      status: ncr.status,
      createdAt: ncr.created_at,
    }));
  const failedInspectionItems: FailedInspectionItem[] = inspectionRecords
    .filter((r) => r.overall_result === "fail")
    .map((r) => ({
      kind: "inspection",
      id: r.id,
      reference: r.record_number,
      description: r.activity,
      status: "fail",
      createdAt: r.created_at,
    }));
  const openItems: OpenItem[] = [...openNcrItems, ...failedInspectionItems].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    firstTimePassRate,
    firstTimePassCounts: { firstAttempts: firstAttempts.length, firstTimePasses: firstTimePasses.length },
    holdPointTurnaroundHours,
    holdPointTurnaroundSource,
    ncrCloseOutHours,
    ncrCloseOutCount: closedNcrs.length,
    dataBookReadiness,
    dataBookReadinessIsProxy: true,
    inspectionsCompleted,
    inspectionsPlanned,
    inspectionsCompletionRate,
    itpCompletionRate,
    itpCompletionCounts: { clientAccepted: clientAcceptedCount, total: itps.length },
    openItems,
  };
}
