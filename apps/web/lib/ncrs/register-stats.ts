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
