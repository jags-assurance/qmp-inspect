// Pure rules for the ITP lifecycle (no I/O), shared by server actions and pages.

/** A superseded or withdrawn ITP is read-only, kept for the record, and not counted in readiness. */
export function isTerminalItpStatus(status: string | null | undefined): boolean {
  return status === "superseded" || status === "withdrawn";
}

/** Checklists may be generated once the ITP is approved, and stay available after client acceptance. */
export function canGenerateChecklistsForStatus(status: string | null | undefined): boolean {
  return status === "approved" || status === "client_accepted";
}

/** Review round number for the next archive of a cleared review chain (rounds start at 1). */
export function nextReviewRound(maxExistingRound: number | null | undefined): number {
  return Math.max(0, maxExistingRound ?? 0) + 1;
}

/**
 * Who may approve an ITP (or an ITP revision).
 *  - A JAGS Admin always may.
 *  - Anyone holding the approve_itp permission may.
 *  - Other JAGS staff may only while the stricter mode is off (default). With ITP_REQUIRE_APPROVE_PERMISSION=1 a plain
 *    staff account needs the approve_itp permission too.
 *  - Non-staff without the permission never may.
 */
export function mayApproveItp(args: { isAdmin: boolean; isJagsStaff: boolean; hasApprovePermission: boolean; strict: boolean }): boolean {
  if (args.isAdmin || args.hasApprovePermission) return true;
  return args.isJagsStaff && !args.strict;
}

export function approvePermissionStrict(env: Record<string, string | undefined> = process.env): boolean {
  return env.ITP_REQUIRE_APPROVE_PERMISSION === "1";
}

export interface RevisionApprovalRecipient {
  userId: string;
  role: "changer" | "client" | "acceptor";
}

/**
 * S2-16: who hears that a revision was approved. The client party logins (and the assigned acceptor, when a
 * re-acceptance is now needed) and the person who made the change. Never the approver; no duplicates.
 */
export function revisionApprovalRecipients(args: {
  approverId: string;
  changedBy: string | null;
  clientUserIds: (string | null | undefined)[];
  assignedAcceptorId?: string | null;
}): RevisionApprovalRecipient[] {
  const out: RevisionApprovalRecipient[] = [];
  const seen = new Set<string>([args.approverId]);
  const add = (userId: string | null | undefined, role: RevisionApprovalRecipient["role"]) => {
    if (!userId || seen.has(userId)) return;
    seen.add(userId);
    out.push({ userId, role });
  };
  for (const id of args.clientUserIds) add(id, "client");
  add(args.assignedAcceptorId, "acceptor");
  add(args.changedBy, "changer");
  return out;
}

/** Validates a withdraw/supersede request. Returns an error message or null. */
export function exitRequestError(args: { mode: string; reason: string; replacementId: string; itpId: string }): string | null {
  if (args.reason.trim().length < 5) return "Give a reason (at least 5 characters).";
  if (args.mode === "superseded" && (!args.replacementId || args.replacementId === args.itpId)) return "Choose the ITP that replaces this one.";
  return null;
}
