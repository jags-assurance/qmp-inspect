// Pure helpers for the project status / close flow (a "use server" file may only export async functions).

export interface ProjectCloseCounts {
  openNcrs: number;
  openPunch: number;
  overdueHolds: number;
  draftInspections: number;
}

export function isClosedStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "cancelled";
}

/** Human list such as "2 open NCRs, 1 open punch item" - empty when nothing is outstanding. */
export function describeCloseBlockers(c: ProjectCloseCounts): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const out: string[] = [];
  if (c.openNcrs > 0) out.push(plural(c.openNcrs, "open NCR", "open NCRs"));
  if (c.openPunch > 0) out.push(plural(c.openPunch, "open punch item", "open punch items"));
  if (c.overdueHolds > 0) out.push(plural(c.overdueHolds, "overdue hold point", "overdue hold points"));
  if (c.draftInspections > 0) out.push(plural(c.draftInspections, "draft inspection", "draft inspections"));
  return out;
}

export const MIN_STATUS_REASON_LENGTH = 5;

/** A reason is required when leaving a closed state (completed/cancelled); the close_project RPC enforces the reason when closing with blockers. */
export function statusReasonError(from: string, to: string, reason: string): string | null {
  if (isClosedStatus(from) && from !== to && reason.trim().length < MIN_STATUS_REASON_LENGTH) {
    return `Give a reason (at least ${MIN_STATUS_REASON_LENGTH} characters) for re-opening a ${from} project.`;
  }
  if (reason.length > 1000) return "Reason must be 1000 characters or fewer.";
  return null;
}
