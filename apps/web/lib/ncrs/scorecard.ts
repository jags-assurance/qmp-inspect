// S5-22: per-vendor (responsible party) NCR scorecard. Pure aggregation, unit-tested.
// Withdrawn NCRs are excluded: they were raised in error and say nothing about the vendor.

export interface ScorecardNcr {
  responsible_party_id: string | null;
  severity: string;
  status: string;
  created_at: string;
  closed_at: string | null;
  due_date: string | null;
  reopen_count?: number | null;
  withdrawn_at?: string | null;
}

export interface VendorScore {
  partyId: string | null;
  total: number;
  open: number;
  closed: number;
  major: number;
  minor: number;
  overdue: number;
  reopened: number;
  /** Mean days from raise to close over closed NCRs; null when none are closed. */
  avgDaysToClose: number | null;
  /** Share of closed NCRs closed on or before their due date (null when none had a due date). */
  onTimeRate: number | null;
}

const DAY_MS = 86_400_000;

/** `todayIso` is the site's calendar day (YYYY-MM-DD); an open NCR is overdue when its due date is before it. */
export function buildVendorScorecard(rows: ScorecardNcr[], todayIso: string): VendorScore[] {
  const groups = new Map<string, ScorecardNcr[]>();
  for (const r of rows) {
    if (r.withdrawn_at || r.severity === "observation") continue;
    const key = r.responsible_party_id ?? "";
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: VendorScore[] = [];
  for (const [key, list] of groups) {
    const closedRows = list.filter((r) => r.status === "closed");
    const days = closedRows
      .filter((r) => r.closed_at)
      .map((r) => Math.max(0, (new Date(r.closed_at as string).getTime() - new Date(r.created_at).getTime()) / DAY_MS));
    const withDue = closedRows.filter((r) => r.due_date && r.closed_at);
    const onTime = withDue.filter((r) => (r.closed_at as string).slice(0, 10) <= (r.due_date as string).slice(0, 10)).length;
    out.push({
      partyId: key || null,
      total: list.length,
      open: list.length - closedRows.length,
      closed: closedRows.length,
      major: list.filter((r) => r.severity === "major_ncr").length,
      minor: list.filter((r) => r.severity === "minor_ncr").length,
      overdue: list.filter((r) => r.status !== "closed" && r.due_date && r.due_date.slice(0, 10) < todayIso).length,
      reopened: list.filter((r) => (r.reopen_count ?? 0) > 0).length,
      avgDaysToClose: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 100) : null,
    });
  }
  // Worst first: most open + overdue, then major count, then total.
  return out.sort((a, b) => b.overdue - a.overdue || b.open - a.open || b.major - a.major || b.total - a.total);
}
