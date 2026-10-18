// Activity sign-off progress for one ITP. Pure and shared by the register list so it matches the rule the ITP
// detail page applies (app/inspect/itps/[id]/itp-detail-view.tsx, `pointsByActivity`): one sign-off row exists per
// party per activity; an activity is fully signed off only when EVERY one of its rows has status "signed_off"
// (proceeded_no_response and every other status do not count). Activities with no sign-off rows are not counted.

export interface SignoffRowLike {
  itp_item_id: string;
  status: string;
}

export interface ActivityProgress {
  /** Activities that have at least one sign-off row. */
  total: number;
  /** Activities whose every sign-off row is signed off. */
  complete: number;
  /** Individual sign-off rows not yet signed off. */
  outstanding: number;
  /** 0-100, rounded; 0 when there are no activities. */
  percent: number;
}

export function computeActivityProgress(rows: readonly SignoffRowLike[]): ActivityProgress {
  const byActivity = new Map<string, { total: number; done: number }>();
  for (const row of rows) {
    const entry = byActivity.get(row.itp_item_id) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === "signed_off") entry.done += 1;
    byActivity.set(row.itp_item_id, entry);
  }
  const total = byActivity.size;
  let complete = 0;
  let outstanding = 0;
  for (const e of byActivity.values()) {
    if (e.done === e.total) complete += 1;
    outstanding += e.total - e.done;
  }
  return { total, complete, outstanding, percent: total === 0 ? 0 : Math.round((complete / total) * 100) };
}
