/**
 * Strict readiness percentage. An empty category has nothing outstanding (100). Otherwise the value is
 * floored, and 100 is reachable ONLY when every row is ready: rounding used to turn 199/200 into "100%",
 * which let a category with one outstanding row pass the Data Book gate.
 * KEEP IN SYNC with worker/src/readinessMath.ts and the SQL gate data_book_gate_failures (ready < total fails).
 */
export function strictPercentage(ready: number, total: number): number {
  if (total <= 0) return 100;
  if (ready >= total) return 100;
  return Math.min(99, Math.max(0, Math.floor((ready / total) * 100)));
}

/** A category passes the gate only when every row is ready. */
export function isCategoryComplete(c: { ready: number; total: number }): boolean {
  return c.ready >= c.total;
}
