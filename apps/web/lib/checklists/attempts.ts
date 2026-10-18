/**
 * Inspection attempts. Every run of an activity's inspection is its own record, numbered 0, 1, 2 ... in
 * `inspection_records.revision`. Field staff think of these as Attempt A (the first), Attempt B (the
 * re-inspection after a fail), and so on, so that is how they are shown. Nothing is overwritten: a failed
 * attempt stays on file next to the pass that replaced it.
 */

/** 0 → "A", 1 → "B", 25 → "Z", 26 → "AA". */
export function attemptLabel(revision: number): string {
  let n = Math.max(0, Math.floor(revision));
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export interface AttemptSummary {
  revision: number;
  result: string | null;
}

/** What the person looking at the checklist should do next, given the finished attempts (newest first). */
export function reinspectionState(finished: AttemptSummary[]): {
  /** The attempt a new run would be, e.g. "B". */
  nextLabel: string;
  /** The newest finished attempt failed, so the next run is a re-inspection. */
  isReinspection: boolean;
  failedLabel: string | null;
} {
  const nextRevision = finished.length === 0 ? 0 : Math.max(...finished.map((a) => a.revision)) + 1;
  const latest = [...finished].sort((a, b) => b.revision - a.revision)[0];
  const failed = latest?.result === "fail";
  return {
    nextLabel: attemptLabel(nextRevision),
    isReinspection: failed,
    failedLabel: failed ? attemptLabel(latest.revision) : null,
  };
}
