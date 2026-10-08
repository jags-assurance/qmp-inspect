// Per-project fan-out for the organisation-wide weekly / monthly report packs. After the org pack is
// built and uploaded, a filtered copy is generated for each project and filed in THAT project's vault
// only (reportScope.ts / reportPackAggregation.ts do the scoping). Everything here is pure or takes the
// per-project work as a callback, so the isolation rules are unit tested without a database.
import { JobAbortedError } from "./jobAbort";

/** Time budget for the per-project copies, measured from the start of the job (jobTimeoutMs gives report packs 8 minutes). */
export const PROJECT_PACK_BUDGET_MS = 5 * 60 * 1000;

export interface ProjectActivityRow {
  projectId: string;
  inspectionsCompleted: number;
  ncrsOpened: number;
  ncrsClosed: number;
}

/**
 * Empty-state decision: a project with NO activity in the period (no completed inspections, no NCRs
 * opened or closed) is SKIPPED rather than given a blank pack, so project vaults are not filled with
 * identical empty PDFs every week. ITP completion is an all-time snapshot, not period activity, so it
 * does not count. The organisation-wide pack still lists the project with zeros.
 */
export function hasPeriodActivity(row: Omit<ProjectActivityRow, "projectId">): boolean {
  return row.inspectionsCompleted > 0 || row.ncrsOpened > 0 || row.ncrsClosed > 0;
}

/** Splits the organisation pack's per-project rows into projects that get a pack and those skipped (deduplicated by id). */
export function selectProjectsForPacks<T extends ProjectActivityRow>(rows: T[]): { generate: T[]; skipped: T[] } {
  const seen = new Set<string>();
  const generate: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    if (seen.has(row.projectId)) continue;
    seen.add(row.projectId);
    (hasPeriodActivity(row) ? generate : skipped).push(row);
  }
  return { generate, skipped };
}

export interface ProjectPackOutcome {
  generated: string[];
  skippedNoActivity: string[];
  failed: { projectId: string; message: string }[];
  /** Projects not attempted because the time budget ran out. */
  deferred: string[];
}

/**
 * Runs `generateOne` for each active project, one at a time. A failure in one project is recorded and
 * never stops (or fails) the others. A job abort (the job timed out and was already given up on) is the
 * one error that is re-thrown: no further side effects may happen after it.
 */
export async function runProjectPacks<T extends ProjectActivityRow>(
  rows: T[],
  generateOne: (row: T) => Promise<void>,
  options: { now?: () => number; deadline?: number } = {}
): Promise<ProjectPackOutcome> {
  const now = options.now ?? Date.now;
  const { generate, skipped } = selectProjectsForPacks(rows);
  const outcome: ProjectPackOutcome = { generated: [], skippedNoActivity: skipped.map((r) => r.projectId), failed: [], deferred: [] };
  for (const row of generate) {
    if (options.deadline !== undefined && now() >= options.deadline) {
      outcome.deferred.push(row.projectId);
      continue;
    }
    try {
      await generateOne(row);
      outcome.generated.push(row.projectId);
    } catch (err) {
      if (err instanceof JobAbortedError) throw err;
      outcome.failed.push({ projectId: row.projectId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return outcome;
}

export function describeProjectPackOutcome(label: string, o: ProjectPackOutcome): string {
  return (
    `[worker] ${label}: project packs generated=${o.generated.length} skipped(no activity)=${o.skippedNoActivity.length} ` +
    `failed=${o.failed.length} deferred(time budget)=${o.deferred.length}`
  );
}
