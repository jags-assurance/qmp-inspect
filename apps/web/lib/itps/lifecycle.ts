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

/** Message shown before withdrawing/superseding an ITP that still has open inspections or NCRs; null when there is none. */
export function openWorkMessage(openInspections: number, openNcrs: number): string | null {
  if (openInspections <= 0 && openNcrs <= 0) return null;
  const parts: string[] = [];
  if (openInspections > 0) parts.push(`${openInspections} open (draft) inspection${openInspections === 1 ? "" : "s"}`);
  if (openNcrs > 0) parts.push(`${openNcrs} open NCR${openNcrs === 1 ? "" : "s"}`);
  return `This ITP still has ${parts.join(" and ")}. They stay on record but the ITP becomes read-only. Tick the confirmation box to withdraw or supersede it anyway.`;
}

/** True when following the replacement's own "superseded by" links leads back to this ITP (A -> B -> A). */
export function supersedeCreatesCycle(itpId: string, replacementId: string, nextOf: (id: string) => string | null, maxHops = 25): boolean {
  let cur: string | null = replacementId;
  for (let i = 0; cur && i < maxHops; i++) {
    if (cur === itpId) return true;
    cur = nextOf(cur);
  }
  return false;
}

/** M4: hint shown when the organisation's required approver is deactivated, so only a JAGS Admin can approve. */
export function deactivatedApproverHint(approver: { full_name: string; is_active: boolean | null } | null): string | null {
  if (!approver || approver.is_active !== false) return null;
  return `${approver.full_name}, the approver this organisation requires, is deactivated, so only a JAGS Admin can approve this ITP. Ask an Admin to approve it or to change the approval workflow.`;
}
