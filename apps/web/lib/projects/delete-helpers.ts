// Pure rules for deleting a project or an organisation (a "use server" file may only export async functions).
//
// Deleting removes everything under it (NCRs, punch items, inspections, IRNs, Data Books, documents) through
// the database's cascades and cannot be undone, so it is deliberately narrow: JAGS Admin only, a typed
// confirmation, and only for work that is already out of use.

export type DeleteVerdict = { ok: true } | { ok: false; reason: string };

/** A project can be deleted while it is still a Draft, or once it has been Cancelled. Not while it is live or completed. */
export function canDeleteProject(status: string | null | undefined): DeleteVerdict {
  if (status === "cancelled" || status === "draft") return { ok: true };
  return {
    ok: false,
    reason:
      status === "completed"
        ? "A completed project is a record of work done and cannot be deleted. Cancel it first if it really must go."
        : "Only a Draft or Cancelled project can be deleted. Set the project to Cancelled first.",
  };
}

/** An organisation can be deleted once none of its projects are left. */
export function canDeleteOrganization(projectCount: number): DeleteVerdict {
  if (projectCount === 0) return { ok: true };
  return {
    ok: false,
    reason: `This organisation still has ${projectCount} project${projectCount === 1 ? "" : "s"}. Delete ${projectCount === 1 ? "it" : "them"} first.`,
  };
}

/** The confirmation must match exactly (trimmed, case-sensitive): the project number or the organisation name. */
export function confirmationMatches(typed: string, expected: string): boolean {
  return expected.trim().length > 0 && typed.trim() === expected.trim();
}
