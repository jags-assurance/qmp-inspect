// Pure shaping of the SQL aggregates in supabase/migrations/20261210000500_kpi_aggregates.sql into the
// KPI view models. No I/O here so the math is unit-tested with fixtures; compute.ts does the RPC calls.

export interface MonthlyCountRow {
  year: number;
  month0: number;
  ncr_count: number | string;
  inspection_count: number | string;
}

export interface MonthlyTrendPoint {
  monthStart: string;
  label: string;
  ncrCount: number;
  inspectionsCompletedCount: number;
}

/** 6-month window clipped to the project's own creation month (never fabricates earlier months). */
export function buildMonthlyTrends(rows: MonthlyCountRow[], projectCreatedAt: string, now: Date = new Date()): MonthlyTrendPoint[] {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const projectCreated = new Date(projectCreatedAt);
  const projectMonthStart = new Date(Date.UTC(projectCreated.getUTCFullYear(), projectCreated.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 5, 1));
  const earliest = sixMonthsAgo.getTime() > projectMonthStart.getTime() ? sixMonthsAgo : projectMonthStart;

  const byKey = new Map<string, { n: number; i: number }>();
  for (const r of rows) byKey.set(`${r.year}-${r.month0}`, { n: Number(r.ncr_count), i: Number(r.inspection_count) });

  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const out: MonthlyTrendPoint[] = [];
  const cursor = new Date(earliest);
  while (cursor.getTime() <= currentMonthStart.getTime()) {
    const hit = byKey.get(`${cursor.getUTCFullYear()}-${cursor.getUTCMonth()}`);
    out.push({
      monthStart: cursor.toISOString(),
      label: fmt.format(cursor),
      ncrCount: hit?.n ?? 0,
      inspectionsCompletedCount: hit?.i ?? 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export interface PunchSourceRow {
  source: string;
  open_count: number | string;
  closed_count: number | string;
}

export function buildPunchBySource(
  rows: PunchSourceRow[],
  labels: Record<string, string>
): { source: string; label: string; openCount: number; closedCount: number }[] {
  return rows
    .map((r) => ({ source: r.source, label: labels[r.source] ?? r.source, openCount: Number(r.open_count), closedCount: Number(r.closed_count) }))
    .sort((a, b) => b.openCount + b.closedCount - (a.openCount + a.closedCount));
}

export interface PartyRollupRow {
  party_id: string;
  signoff_total: number | string;
  signoff_signed_off: number | string;
  ncr_count: number | string;
}

export function buildQualityByParty(
  rows: PartyRollupRow[],
  nameById: Map<string, string>
): { partyName: string; percentage: number | null; ncrCount: number }[] {
  return rows
    .map((r) => {
      const total = Number(r.signoff_total);
      return {
        partyName: nameById.get(r.party_id) ?? "Unknown party",
        percentage: total > 0 ? Math.round((Number(r.signoff_signed_off) / total) * 100) : null,
        ncrCount: Number(r.ncr_count),
      };
    })
    .sort((a, b) => (b.percentage ?? -1) - (a.percentage ?? -1));
}

export interface OpenNcrProjectRow {
  project_id: string;
  organization_id: string | null;
  open_count: number | string;
}

export function sumOpenNcrs(rows: OpenNcrProjectRow[]): {
  byProject: Map<string, number>;
  byOrg: Map<string, number>;
  total: number;
} {
  const byProject = new Map<string, number>();
  const byOrg = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const n = Number(r.open_count);
    total += n;
    byProject.set(r.project_id, (byProject.get(r.project_id) ?? 0) + n);
    if (r.organization_id) byOrg.set(r.organization_id, (byOrg.get(r.organization_id) ?? 0) + n);
  }
  return { byProject, byOrg, total };
}
