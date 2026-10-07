// Pure rules for the written "no evidence" waiver on inspection completion (S4-16, S4-19).

const WAIVER_LINE = /^\[No evidence attached[^\]]*\]\s*\n?/;

/** Removes any number of leading "[No evidence attached — reason: …]" lines left by an earlier completion. */
export function stripWaiverPrefix(notes: string): string {
  let out = notes;
  while (WAIVER_LINE.test(out)) out = out.replace(WAIVER_LINE, "");
  return out.trim();
}

/**
 * A written reason may stand in for photo/document evidence only on a record with no "No" answers,
 * unless JAGS staff are completing it (their own signature accepts the waiver).
 */
export function canWaiveEvidence(input: { isStaff: boolean; hasNoAnswers: boolean }): boolean {
  return input.isStaff || !input.hasNoAnswers;
}
