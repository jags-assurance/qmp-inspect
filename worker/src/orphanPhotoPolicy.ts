// S4-19: pure rules for the orphaned-photo flagging sweep. No database or env access.
// The sweep only FLAGS; nothing here or in orphanPhotos.ts deletes a storage object.

/** Objects younger than this are never candidates (an upload may still be about to get its row). */
export const ORPHAN_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The sweep runs at most this often. */
export const ORPHAN_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const ORPHAN_PAGE_SIZE = 500;
export const ORPHAN_MAX_PAGES = 10;

export function orphanCutoffIso(now: number): string {
  return new Date(now - ORPHAN_MIN_AGE_MS).toISOString();
}

export function shouldRunOrphanSweep(lastRunAt: number | null, now: number): boolean {
  return lastRunAt === null || now - lastRunAt >= ORPHAN_SWEEP_INTERVAL_MS;
}

export interface OrphanCandidate {
  storage_path: string;
  organization_id: string;
  size_bytes: number | null;
}

/** Groups candidates by organisation so each organisation's admins get one notice. */
export function countByOrganisation(candidates: OrphanCandidate[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.organization_id, (counts.get(c.organization_id) ?? 0) + 1);
  return counts;
}
