// Impact window for a calibration out-of-tolerance finding (S3-03). A recalibration is a NEW register row
// linked to the previous one (supersedes_id), and every checklist answer links to the row that was current
// when it was recorded. If an instrument is found out of tolerance, the answers that used it since its last
// KNOWN-GOOD calibration are impacted: the cycle's own row, plus earlier cycles back to the first one whose
// as-found result was recorded as "in tolerance" (when the as-found of a previous cycle wasn't recorded, that
// cycle can't be cleared, so it is included — the conservative reading).

export interface CalibrationCycle {
  id: string;
  supersedes_id: string | null;
  as_found_result: string | null;
  cal_date?: string | null;
  cert_number?: string;
}

/** Ids of the calibration rows whose uses are impacted if the cycle `hitId` is found out of tolerance. */
export function impactedCycleIds(hitId: string, cycles: CalibrationCycle[]): string[] {
  const byId = new Map(cycles.map((c) => [c.id, c]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(hitId);
  if (!current) return [hitId];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ids.push(current.id);
    const previous: CalibrationCycle | undefined = current.supersedes_id ? byId.get(current.supersedes_id) : undefined;
    if (!previous || previous.as_found_result === "in_tolerance") break;
    current = previous;
  }
  return ids;
}
