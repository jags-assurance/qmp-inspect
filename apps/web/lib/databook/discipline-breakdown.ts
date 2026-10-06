// R88: service/discipline breakdown of a project's Data Book, layered on top of the existing
// project-wide readiness.ts totals rather than replacing them — same aggregation, just grouped by
// itp_items.discipline_id (master_disciplines), the same discipline concept already used by the
// ITP register's discipline filter (app/inspect/itps/page.tsx) and the KPI dashboard's
// computeFirstTimePassRateByDiscipline (lib/kpis/compute.ts). This module mirrors that function's
// "which ITPs/NCRs/records touch this discipline" logic, extended with ITP and NCR subtotals.
//
// Honesty rule, same as everywhere else in this file's siblings: an itp_item with no discipline_id
// set, or an NCR with no itp_item_id (so no discipline can be resolved for it), is excluded from
// every discipline's bucket rather than guessed at or dumped into a fake "Unassigned" row. The
// project-wide totals in readiness.ts already cover every ITP/NCR regardless of discipline tagging;
// this breakdown is an additional lens on the same real rows, not a replacement for that total.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NCRS_TABLE } from "@/lib/ncrs/types";

export interface DataBookDisciplineRow {
  disciplineCode: string;
  disciplineName: string;
  /** Distinct ITPs with at least one item tagged with this discipline. An ITP spanning multiple
   *  disciplines is counted once in each — same convention as the ITP register's discipline filter. */
  itpCount: number;
  /** NCRs raised against an item tagged with this discipline (via ncrs.itp_item_id). */
  ncrCount: number;
  firstAttempts: number;
  firstTimePasses: number;
  /** null when this discipline has zero first attempts recorded yet. */
  firstTimePassRate: number | null;
}

interface DisciplineAgg {
  itpIds: Set<string>;
  ncrCount: number;
  firstAttempts: number;
  firstTimePasses: number;
}

export async function computeDataBookDisciplineBreakdown(projectId: string): Promise<DataBookDisciplineRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data: itps } = await supabase
    .from("itps")
    .select("id")
    .eq("project_id", projectId)
    .in("status", ["approved", "client_accepted"])
    .returns<{ id: string }[]>();
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

  const [{ data: records }, { data: ncrs }] = await Promise.all([
    supabase
      .from("inspection_records")
      .select("itp_item_id, overall_result, created_at")
      .in("itp_item_id", itemIds)
      .order("created_at", { ascending: true })
      .returns<{ itp_item_id: string; overall_result: "pass" | "fail" | "partial" | null; created_at: string }[]>(),
    supabase
      .from(NCRS_TABLE)
      .select("id, itp_item_id")
      .eq("project_id", projectId)
      .not("itp_item_id", "is", null)
      .returns<{ id: string; itp_item_id: string }[]>(),
  ]);

  // First attempt per item — same "earliest inspection_record wins" rule as computeProjectKpis and
  // computeFirstTimePassRateByDiscipline in lib/kpis/compute.ts.
  const firstAttemptByItem = new Map<string, { overall_result: "pass" | "fail" | "partial" | null }>();
  for (const record of records ?? []) {
    if (!firstAttemptByItem.has(record.itp_item_id)) firstAttemptByItem.set(record.itp_item_id, record);
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

  for (const ncr of ncrs ?? []) {
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
