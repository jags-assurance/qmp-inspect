// Pure reducers that replace several `select id, count head` round trips on the same table with ONE
// light row query. Each head-count used to re-run the table's row-level security over the project's
// rows; one query that returns two narrow columns does it once.

/** Splits a project's open (not closed) ncrs rows into NCRs and observations. */
export function countOpenNcrs(rows: ReadonlyArray<{ severity: string }>): { ncrs: number; observations: number; total: number } {
  let observations = 0;
  for (const r of rows) if (r.severity === "observation") observations += 1;
  return { ncrs: rows.length - observations, observations, total: rows.length };
}

/**
 * From a project's NOT-closed punch rows: `outstanding` (everything not closed), `open` (status 'open')
 * and `resolved` (status 'resolved').
 */
export function countPunchByStatus(rows: ReadonlyArray<{ status: string }>): { outstanding: number; open: number; resolved: number } {
  let open = 0;
  let resolved = 0;
  for (const r of rows) {
    if (r.status === "open") open += 1;
    else if (r.status === "resolved") resolved += 1;
  }
  return { outstanding: rows.length, open, resolved };
}

/**
 * True when a list fetched with `.limit(cap)` was cut short by the cap, i.e. its length is NOT the true
 * total and an exact count query is still needed.
 */
export function listHitCap(rows: ReadonlyArray<unknown> | null | undefined, cap: number): boolean {
  return (rows?.length ?? 0) >= cap;
}

/** Distinct organisations (id + name), sorted by name, from rows that embed `organizations(name)`. */
export function orgFilterOptionsFrom(
  rows: ReadonlyArray<{ organization_id: string; organizations: { name: string } | null }>
): { id: string; label: string }[] {
  return [
    ...new Map(
      rows.filter((p) => p.organizations).map((p) => [p.organization_id, { id: p.organization_id, label: p.organizations!.name }])
    ).values(),
  ].sort((a, b) => a.label.localeCompare(b.label));
}
