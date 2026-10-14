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
import { INTERVENTION_LEVEL_TYPES_TABLE } from "@/lib/intervention-levels/types";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  buildMonthlyTrends,
  buildPunchBySource,
  buildQualityByParty,
  type MonthlyCountRow,
  type MonthlyTrendPoint,
  type PartyRollupRow,
  type PunchSourceRow,
} from "./aggregates";
import { fetchAllInChunks, loadItemsForSections, loadProjectItpIds, loadSectionsForItps } from "./queries";

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

export interface FirstAttemptRecordRow {
  id: string;
  recordNumber: string;
  activity: string;
  itpNumber: string | null;
  result: "pass" | "fail" | "partial" | null;
  recordedAt: string;
}

export interface ProjectKpis {
  /** % of itp_items whose earliest inspection_record (by created_at) passed on the first attempt. */
  firstTimePassRate: number | null;
  firstTimePassCounts: { firstAttempts: number; firstTimePasses: number };
  /** The actual first-attempt records behind firstTimePassRate, newest first — lets the KPI tile
   *  drill in to what it's computed from instead of just stating the number. */
  firstAttemptRecords: FirstAttemptRecordRow[];

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
  /** null when this party has no activity_signoff_progress rows on this project at all (e.g. it
   *  only ever shows up here via an NCR raised against it) — never fabricated as 0/0 = 0%. */
  percentage: number | null;
  /** R68: NCRs raised on this project with ncrs.responsible_party_id = this party, via the FK
   *  added by 20260926010000_ncr_responsible_party.sql. 0 is a real, shown count (contrast with
   *  the sign-off percentage's "omit if no rows" rule above — a party with a percentage but zero
   *  NCRs against it genuinely has zero, which is worth showing, not hiding). */
  ncrCount: number;
}

/**
 * Ranks each project party by their sign-off completion rate: signed-off activity_signoff_progress
 * rows / total rows for that party, scoped to this project via
 * activity_signoff_progress -> itp_items -> itp_sections -> itps (itps.project_id = projectId).
 * Also rolls up each party's NCR count on this project (R68) via ncrs.responsible_party_id, so a
 * party shows up here — with ncrCount but no percentage — even if it has no sign-off rows at all.
 * A party with neither sign-off rows nor any NCRs against it is omitted entirely (never shown as
 * 0/0 = 0%, and never shown as an all-zero row with nothing real behind it).
 */
export async function computeQualityByParty(supabase: SupabaseClient, projectId: string): Promise<QualityByPartyRow[]> {
  // One SQL aggregate (kpi_party_rollup) instead of paging every ITP / section / item / sign-off row
  // into memory. SECURITY INVOKER, so RLS scopes it exactly like the table reads it replaces.
  const { data, error } = await supabase.rpc("kpi_party_rollup", { p_project_id: projectId });
  if (error) throw new Error(`Could not load party rollup: ${error.message}`);
  const rows = (data ?? []) as PartyRollupRow[];
  if (rows.length === 0) return [];

  const { data: parties } = await supabase
    .from("project_parties")
    .select("id, name")
    .in("id", rows.map((r) => r.party_id))
    .returns<{ id: string; name: string }[]>();
  return buildQualityByParty(rows, new Map((parties ?? []).map((p) => [p.id, p.name])));
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
  const itpIds = await loadProjectItpIds(supabase, projectId);
  if (itpIds.length === 0) return [];

  const sectionIds = (await loadSectionsForItps(supabase, itpIds)).map((sec) => sec.id);
  if (sectionIds.length === 0) return [];

  const items = (await loadItemsForSections<{ id: string; discipline_id: string | null }>(supabase, sectionIds, "id, discipline_id")).filter(
    (i): i is { id: string; discipline_id: string } => i.discipline_id !== null
  );
  const itemIds = items.map((i) => i.id);
  if (itemIds.length === 0) return [];

  const disciplineByItem = new Map(items.map((i) => [i.id, i.discipline_id]));

  const records = await fetchAllInChunks<
    { itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string },
    string
  >(itemIds, (chunk, from, to) =>
    supabase
      .from("inspection_records")
      .select("itp_item_id, overall_result, created_at")
      .in("itp_item_id", chunk)
      .order("created_at", { ascending: true })
      .order("id")
      .range(from, to)
      .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string }[]>()
  );
  // Chunks are concatenated, so restore the global first-attempt order.
  records.sort((x, y) => x.created_at.localeCompare(y.created_at));

  const firstAttemptByItem = new Map<string, (typeof records)[number]>();
  for (const record of records) {
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

export type { MonthlyTrendPoint } from "./aggregates";

/**
 * Real per-project monthly trend of NCR volume and inspection-completion counts, over the last 6
 * calendar months — the same underlying rows (ncrs.created_at, inspection_records.created_at)
 * already read/aggregated elsewhere in this file, just bucketed by month instead of collapsed to a
 * single current-snapshot number. Mirrors the shape of vw_powerbi_ncr_trends (Power BI's
 * project/severity/status/month grouping over the same `ncrs` table -
 * supabase/migrations/20260910120000_phase3_powerbi_reporting_views.sql) but queried directly
 * against the project-scoped, RLS-protected tables rather than that view, since that view is
 * intentionally reachable only by the internal `powerbi_reader` login role and carries no
 * per-row tenant filtering of its own.
 *
 * Honesty rule: never fabricate months. The window is clipped to whichever is later — "6 months
 * ago" or the project's own `created_at` month — so a brand-new project only ever shows the
 * month(s) it has actually existed for, never a run of fake leading zero-NCR months that could be
 * mistaken for real history predating the project.
 */
export async function computeMonthlyTrends(
  supabase: SupabaseClient,
  projectId: string,
  projectCreatedAt: string
): Promise<MonthlyTrendPoint[]> {
  // Per-month counts come from one SQL aggregate (kpi_monthly_counts) rather than every NCR and
  // inspection row; bucketing is UTC, identical to the previous in-memory pass.
  const { data, error } = await supabase.rpc("kpi_monthly_counts", { p_project_id: projectId });
  if (error) throw new Error(`Could not load monthly trends: ${error.message}`);
  return buildMonthlyTrends((data ?? []) as MonthlyCountRow[], projectCreatedAt);
}

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (1000 * 60 * 60);
}

export async function computeProjectKpis(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectKpis> {
  const [itps, ncrs, projectResult] = await Promise.all([
    fetchAll<{ id: string; itp_number: string; status: "draft" | "under_review" | "approved" | "client_accepted"; updated_at: string }>((from, to) =>
      supabase
        .from("itps")
        .select("id, itp_number, status, updated_at")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to)
        .returns<{ id: string; itp_number: string; status: "draft" | "under_review" | "approved" | "client_accepted"; updated_at: string }[]>()
    ),
    fetchAll<Pick<NcrRow, "id" | "ncr_number" | "description" | "status" | "created_at" | "closed_at">>((from, to) =>
      supabase
        .from(NCRS_TABLE)
        .select("id, ncr_number, description, status, created_at, closed_at")
        .eq("project_id", projectId)
        .order("id")
        .range(from, to)
        .returns<Pick<NcrRow, "id" | "ncr_number" | "description" | "status" | "created_at" | "closed_at">[]>()
    ),
    supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle<{ organization_id: string }>(),
  ]);

  // Blocking-level codes (Hold-equivalent) for THIS project's organisation — no longer a hardcoded
  // "H" — so "Hold-point turnaround" actually reflects whatever level(s) this org has configured as
  // is_blocking, including a custom one.
  const { data: blockingLevelsForProject } = projectResult.data?.organization_id
    ? await supabase
        .from(INTERVENTION_LEVEL_TYPES_TABLE)
        .select("code")
        .eq("organization_id", projectResult.data.organization_id)
        .eq("is_blocking", true)
        .returns<{ code: string }[]>()
    : { data: [] as { code: string }[] };
  const blockingCodes = (blockingLevelsForProject ?? []).map((l) => l.code);

  const itpIds = itps.map((itp) => itp.id);
  const approvedOrAcceptedItpIds = itps
    .filter((itp) => itp.status === "approved" || itp.status === "client_accepted")
    .map((itp) => itp.id);

  const sections = await loadSectionsForItps(supabase, itpIds);
  const sectionIds = sections.map((sec) => sec.id);
  const sectionToItp = new Map(sections.map((sec) => [sec.id, sec.itp_id]));

  const itpItems = await loadItemsForSections<{ id: string; section_id: string; evidence_type: 1 | 2 | 3 }>(
    supabase,
    sectionIds,
    "id, section_id, evidence_type"
  );
  const itemToItp = new Map(itpItems.map((item) => [item.id, sectionToItp.get(item.section_id) ?? null]));

  const [inspectionRecords, holdSignoffs] = await Promise.all([
    fetchAll<{
      id: string;
      record_number: string;
      activity: string;
      itp_item_id: string;
      overall_result: "pass" | "fail" | "partial" | null;
      notes: string | null;
      created_at: string;
    }>((from, to) =>
      supabase
        .from("inspection_records")
        .select("id, record_number, activity, itp_item_id, overall_result, notes, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .order("id")
        .range(from, to)
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
        >()
    ),
    itpItems.length > 0 && blockingCodes.length > 0
      ? fetchAllInChunks<{ itp_item_id: string; intervention: string; notified_at: string | null; signed_off_at: string | null }, string>(
          itpItems.map((item) => item.id),
          (chunk, from, to) =>
            supabase
              .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
              .select("itp_item_id, intervention, notified_at, signed_off_at")
              .in("intervention", blockingCodes)
              .in("itp_item_id", chunk)
              .order("id")
              .range(from, to)
              .returns<{ itp_item_id: string; intervention: string; notified_at: string | null; signed_off_at: string | null }[]>()
        )
      : Promise.resolve([] as { itp_item_id: string; intervention: string; notified_at: string | null; signed_off_at: string | null }[]),
  ]);

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
  const itpNumberByItpId = new Map(itps.map((itp) => [itp.id, itp.itp_number]));
  const firstAttemptRecords: FirstAttemptRecordRow[] = firstAttempts
    .map((r) => ({
      id: r.id,
      recordNumber: r.record_number,
      activity: r.activity,
      itpNumber: itpNumberByItpId.get(itemToItp.get(r.itp_item_id) ?? "") ?? null,
      result: r.overall_result,
      recordedAt: r.created_at,
    }))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

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
    firstAttemptRecords,
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

export interface OverdueItem {
  kind: "ncr" | "punch";
  id: string;
  reference: string;
  description: string;
  dueDate: string;
  daysOverdue: number;
}

/**
 * Real SLA/overdue tracking — an open NCR or punch item whose due_date has already passed. Both
 * tables already carry a due_date column (ncrs: required at raise time; punch_list_items:
 * optional), so this is a plain "still open AND due_date < today" filter, nothing computed or
 * estimated. Sorted worst-first (most days overdue) since that's what a project manager actually
 * wants to see first — the industry-standard "SLA breach" view most QA dashboards surface
 * separately from a plain open-items list.
 */
export async function computeOverdueItems(supabase: SupabaseClient, projectId: string): Promise<OverdueItem[]> {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [ncrsResult, punchResult] = await Promise.all([
    supabase
      .from(NCRS_TABLE)
      .select("id, ncr_number, description, due_date, status")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .not("due_date", "is", null)
      .lt("due_date", todayIso)
      .returns<{ id: string; ncr_number: string; description: string; due_date: string; status: string }[]>(),
    supabase
      .from("punch_list_items")
      .select("id, description, due_date, status")
      .eq("project_id", projectId)
      .neq("status", "closed")
      .not("due_date", "is", null)
      .lt("due_date", todayIso)
      .returns<{ id: string; description: string; due_date: string; status: string }[]>(),
  ]);

  const now = Date.now();
  const daysSince = (dateStr: string) => Math.floor((now - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));

  const overdueNcrs: OverdueItem[] = (ncrsResult.data ?? []).map((n) => ({
    kind: "ncr" as const,
    id: n.id,
    reference: n.ncr_number,
    description: n.description,
    dueDate: n.due_date,
    daysOverdue: daysSince(n.due_date),
  }));
  const overduePunch: OverdueItem[] = (punchResult.data ?? []).map((p) => ({
    kind: "punch" as const,
    id: p.id,
    reference: p.id.slice(0, 8),
    description: p.description,
    dueDate: p.due_date,
    daysOverdue: daysSince(p.due_date),
  }));

  return [...overdueNcrs, ...overduePunch].sort((a, b) => b.daysOverdue - a.daysOverdue);
}

export const PUNCH_LIST_SOURCE_LABEL: Record<string, string> = {
  inspection_failure: "Failed inspection",
  fat_conditional_pass: "FAT conditional pass",
  ncr: "NCR",
  walkdown: "Walkdown",
  manual: "Manual",
};

/**
 * Real Pareto-style breakdown of where every punch list item actually came from — the standard
 * "what's really driving our defects" cut a QA dashboard needs, computed from the plain `source`
 * column already stamped on every row at creation (lib/punch-list/actions.ts), never inferred.
 */
export async function computePunchListBySource(
  supabase: SupabaseClient,
  projectId: string
): Promise<{ source: string; label: string; openCount: number; closedCount: number }[]> {
  // "Resolved but not yet verified" still counts as open (only status 'closed' is closed); the SQL
  // aggregate (kpi_punch_by_source) applies that rule and is not subject to the 1000-row read cap.
  const { data, error } = await supabase.rpc("kpi_punch_by_source", { p_project_id: projectId });
  if (error) throw new Error(`Could not load punch list breakdown: ${error.message}`);
  return buildPunchBySource((data ?? []) as PunchSourceRow[], PUNCH_LIST_SOURCE_LABEL);
}

export interface OpenHoldItem {
  itpItemId: string;
  activity: string;
  itpNumber: string;
  partyName: string;
  status: SignoffStatus;
  notifiedAt: string | null;
  hoursOpen: number | null;
}

/**
 * Every currently-open Hold-level sign-off (blocking, per the org's own intervention_level_types —
 * never hardcoded to the literal code 'H', same rule the rest of the sign-off system already
 * follows), with how long it's been sitting since it was notified. This is the real "what's
 * physically stopping work right now, and for how long" view — distinct from the aggregate
 * hold-point-turnaround average already on this dashboard, which only reflects CLOSED holds.
 */
export async function computeOpenHolds(supabase: SupabaseClient, projectId: string): Promise<OpenHoldItem[]> {
  const { data: itemRows } = await supabase
    .from("itp_items")
    .select("id, activity, itp_sections(itps(itp_number, project_id))")
    .returns<
      { id: string; activity: string; itp_sections: { itps: { itp_number: string; project_id: string } | null } | null }[]
    >();

  const itemsForProject = (itemRows ?? []).filter((row) => row.itp_sections?.itps?.project_id === projectId);
  const itemIds = itemsForProject.map((row) => row.id);
  if (itemIds.length === 0) return [];

  const [{ data: signoffs }, { data: levelTypes }, { data: parties }] = await Promise.all([
    supabase
      .from(ACTIVITY_SIGNOFF_PROGRESS_TABLE)
      .select("itp_item_id, project_party_id, intervention, status, notified_at")
      .in("itp_item_id", itemIds)
      .in("status", ["pending", "notified"])
      .returns<{ itp_item_id: string; project_party_id: string; intervention: string; status: SignoffStatus; notified_at: string | null }[]>(),
    supabase.from(INTERVENTION_LEVEL_TYPES_TABLE).select("code, is_blocking").returns<{ code: string; is_blocking: boolean }[]>(),
    supabase.from("project_parties").select("id, name").eq("project_id", projectId).returns<{ id: string; name: string }[]>(),
  ]);

  const blockingCodes = new Set((levelTypes ?? []).filter((l) => l.is_blocking).map((l) => l.code));
  const itemById = new Map(itemsForProject.map((row) => [row.id, row]));
  const partyNameById = new Map((parties ?? []).map((p) => [p.id, p.name]));
  const now = Date.now();

  return (signoffs ?? [])
    .filter((row) => blockingCodes.has(row.intervention))
    .map((row) => {
      const item = itemById.get(row.itp_item_id);
      return {
        itpItemId: row.itp_item_id,
        activity: item?.activity ?? "Unknown activity",
        itpNumber: item?.itp_sections?.itps?.itp_number ?? "—",
        partyName: partyNameById.get(row.project_party_id) ?? "Unknown party",
        status: row.status,
        notifiedAt: row.notified_at,
        hoursOpen: row.notified_at ? (now - new Date(row.notified_at).getTime()) / (1000 * 60 * 60) : null,
      };
    })
    .sort((a, b) => (b.hoursOpen ?? 0) - (a.hoursOpen ?? 0));
}
