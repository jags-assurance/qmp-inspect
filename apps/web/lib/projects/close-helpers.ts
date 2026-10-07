// Pure helpers for the project status / close flow (a "use server" file may only export async functions).

export interface ProjectCloseCounts {
  openNcrs: number;
  openPunch: number;
  overdueHolds: number;
  draftInspections: number;
  /** Data books not yet issued (draft or compiled). Optional so older callers keep compiling. */
  unissuedDataBooks?: number;
  /** ITP revisions edited after approval and still waiting for approval. */
  pendingItpRevisions?: number;
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
  const books = c.unissuedDataBooks ?? 0;
  if (books > 0) out.push(plural(books, "unissued data book", "unissued data books"));
  const revisions = c.pendingItpRevisions ?? 0;
  if (revisions > 0) out.push(plural(revisions, "ITP revision awaiting approval", "ITP revisions awaiting approval"));
  return out;
}

export const MIN_STATUS_REASON_LENGTH = 5;

/** Closing with blockers needs a real reason, the same minimum used for re-opening. */
export function closeOverrideReasonError(blockers: string[], reason: string): string | null {
  if (blockers.length > 0 && reason.trim().length < MIN_STATUS_REASON_LENGTH) {
    return `Give a reason (at least ${MIN_STATUS_REASON_LENGTH} characters) to close with ${blockers.join(", ")} outstanding.`;
  }
  return null;
}

/** A reason is required when leaving a closed state (completed/cancelled); the close_project RPC enforces the reason when closing with blockers. */
export function statusReasonError(from: string, to: string, reason: string): string | null {
  if (isClosedStatus(from) && from !== to && reason.trim().length < MIN_STATUS_REASON_LENGTH) {
    return `Give a reason (at least ${MIN_STATUS_REASON_LENGTH} characters) for re-opening a ${from} project.`;
  }
  // A closing override reason must be a real reason too (the RPC records it), not a single character.
  if (to === "completed" && reason.trim().length > 0 && reason.trim().length < MIN_STATUS_REASON_LENGTH) {
    return `A reason for closing with open items must be at least ${MIN_STATUS_REASON_LENGTH} characters.`;
  }
  if (reason.length > 1000) return "Reason must be 1000 characters or fewer.";
  return null;
}
