// Pure rule for the one-time terms banner (U7). No database or framework imports.

export interface TermsRow {
  terms_accepted_at: string | null;
  terms_version: string | null;
}

/** True when the user has not accepted the CURRENT version (never accepted, or accepted an older one). */
export function needsTermsAcceptance(row: TermsRow | null | undefined, currentVersion: string): boolean {
  if (!row) return false; // no row to judge (profile missing): do not nag
  if (!row.terms_accepted_at) return true;
  return row.terms_version !== currentVersion;
}
