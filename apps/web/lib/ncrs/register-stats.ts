// Stat-card numbers for the Observation register from ONE light row query (status, due_date,
// created_at) instead of four head-count queries plus a separate open-ages query — each of which re-ran
// the ncrs row-level security over the whole table.

export interface ObservationStatRow {
  status: string;
  due_date: string | null;
  created_at: string;
}

export interface ObservationStats {
  total: number;
  open: number;
  closed: number;
  overdue: number;
  /** Whole days since creation, for every OPEN row (feeds the aging chart). */
  openAgeDays: number[];
}

/** `todayIso` is a YYYY-MM-DD date; overdue = open with a due date strictly before it. */
export function summariseObservationRows(rows: ReadonlyArray<ObservationStatRow>, nowMs: number, todayIso: string): ObservationStats {
  let open = 0;
  let closed = 0;
  let overdue = 0;
  const openAgeDays: number[] = [];
  for (const r of rows) {
    if (r.status === "closed") {
      closed += 1;
      continue;
    }
    open += 1;
    if (r.due_date !== null && r.due_date < todayIso) overdue += 1;
    openAgeDays.push(Math.floor((nowMs - new Date(r.created_at).getTime()) / 86_400_000));
  }
  return { total: rows.length, open, closed, overdue, openAgeDays };
}

export interface RegisterStatsResult {
  total: number;
  open: number;
  closed: number;
  overdue: number;
  statusCounts: Record<string, number>;
  /** Open items by age: 0-7, 8-14, 15-30, 30+ days. */
  aging: number[];
}

export interface RegisterStatsParams {
  observations: boolean;
  projectId?: string | null;
  severity?: string | null;
  assignee?: string | null;
  userId?: string | null;
  /** null = no discipline filter; an array (even empty) restricts to NCRs linked to those ITP items. */
  itpItemIds?: string[] | null;
  todayIso: string;
  nowMs: number;
}

/** Parses the jsonb the `register_stats` SQL function returns; null when it is not that shape. */
export function parseRegisterStats(raw: unknown): RegisterStatsResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const total = num(r.total);
  const open = num(r.open);
  const closed = num(r.closed);
  const overdue = num(r.overdue);
  if (total === null || open === null || closed === null || overdue === null) return null;
  const aging = Array.isArray(r.aging) && r.aging.length === 4 ? r.aging.map((v) => num(v) ?? 0) : [0, 0, 0, 0];
  const statusCounts: Record<string, number> = {};
  if (r.status_counts && typeof r.status_counts === "object") {
    for (const [k, v] of Object.entries(r.status_counts as Record<string, unknown>)) statusCounts[k] = num(v) ?? 0;
  }
  return { total, open, closed, overdue, statusCounts, aging };
}

/** Same result from raw rows (the fallback while the SQL function is not applied yet). */
export function registerStatsFromRows(rows: ReadonlyArray<ObservationStatRow>, nowMs: number, todayIso: string): RegisterStatsResult {
  const s = summariseObservationRows(rows, nowMs, todayIso);
  const aging = [0, 0, 0, 0];
  for (const d of s.openAgeDays) aging[d <= 7 ? 0 : d <= 14 ? 1 : d <= 30 ? 2 : 3]++;
  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  return { total: s.total, open: s.open, closed: s.closed, overdue: s.overdue, statusCounts, aging };
}

/** The `register_stats` RPC arguments for these params. */
export function registerStatsRpcArgs(p: RegisterStatsParams) {
  return {
    p_observations: p.observations,
    p_project_id: p.projectId || null,
    p_severity: p.severity || null,
    p_assignee: p.assignee || null,
    p_user_id: p.userId || null,
    p_itp_item_ids: p.itpItemIds ?? null,
    p_today: p.todayIso,
    p_now: new Date(p.nowMs).toISOString(),
  };
}
