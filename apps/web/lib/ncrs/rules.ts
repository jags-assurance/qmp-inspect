// Pure NCR rule helpers (no I/O) so they can be unit-tested without a Supabase request context.

/** Photos plus linked vault documents both count as close-out evidence. */
export function evidenceCount(photoCount: number, documentCount: number): number {
  return Math.max(0, photoCount || 0) + Math.max(0, documentCount || 0);
}

/** A photo's storage path must live under this NCR's own folder in its own project. */
export function ncrPhotoPrefix(projectId: string, ncrId: string): string {
  return `${projectId}/ncrs/${ncrId}/`;
}

export function isValidNcrPhotoPath(projectId: string, ncrId: string, path: string): boolean {
  if (!projectId || !ncrId || !path) return false;
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  const prefix = ncrPhotoPrefix(projectId, ncrId);
  return path.startsWith(prefix) && path.length > prefix.length;
}

export interface NcrActorContext {
  isStaff: boolean;
  userId: string;
  raisedBy: string | null;
  assignedTo: string | null;
  /** project_parties.user_id of the NCR's responsible party, if any. */
  partyUserId: string | null;
  /** The responsible party's team members (project_party_members) — they act for the party too. */
  partyMemberIds?: string[];
}

/** Who may work the NCR (CAPA text, evidence, quick status moves). */
export function canWorkNcr(ctx: NcrActorContext): boolean {
  return (
    ctx.isStaff ||
    ctx.raisedBy === ctx.userId ||
    ctx.assignedTo === ctx.userId ||
    (!!ctx.partyUserId && ctx.partyUserId === ctx.userId) ||
    (ctx.partyMemberIds ?? []).includes(ctx.userId)
  );
}

/** Assignment, due date and responsible party are staff-or-raiser only. */
export function canEditAssignment(ctx: Pick<NcrActorContext, "isStaff" | "userId" | "raisedBy">): boolean {
  return ctx.isStaff || ctx.raisedBy === ctx.userId;
}

/** CAPA text is locked for everyone but staff and close-authority holders (who verify it) once the NCR awaits verification. */
export function canEditCapa(status: string, isStaff: boolean, isCloser = false): boolean {
  if (status === "closed") return false;
  if (status === "pending_verification") return isStaff || isCloser;
  return true;
}

/** Evidence (photos, linked documents) follows the same lock as the CAPA text. */
export function canChangeEvidence(status: string, isStaff: boolean, isCloser: boolean): boolean {
  return canEditCapa(status, isStaff, isCloser);
}

/** Description / requirement / location etc.: the raiser or staff, until the NCR awaits verification. */
export function canEditNcrDetails(status: string, isStaff: boolean, isRaiser: boolean): boolean {
  return (status === "open" || status === "in_progress") && (isStaff || isRaiser);
}

/** Withdraw (raised in error / duplicate): close authority, or the raiser of a not-yet-started NCR. */
export function canWithdrawNcr(status: string, isCloser: boolean, isRaiser: boolean): boolean {
  if (status === "closed") return false;
  return isCloser || (isRaiser && status === "open");
}

export const WITHDRAW_REASON_MIN = 5;
export const SOD_OVERRIDE_REASON_MIN = 10;

/**
 * Segregation of duties on verification: whoever is assigned the NCR, or last wrote its root cause /
 * corrective / preventive action, must not verify and close their own work. Admins may, but only with
 * a written override reason (audited). Returns what the closer must do.
 */
export function selfVerificationCheck(input: {
  closerId: string;
  isAdmin: boolean;
  assignedTo: string | null;
  capaUpdatedBy: string | null;
  overrideReason: string;
}): { ok: true; override: string | null } | { ok: false; error: string } {
  const conflict = input.closerId === input.assignedTo || (!!input.capaUpdatedBy && input.closerId === input.capaUpdatedBy);
  if (!conflict) return { ok: true, override: null };
  if (!input.isAdmin) {
    return { ok: false, error: "You are assigned to this NCR or wrote its corrective action — a different person must verify and close it." };
  }
  const reason = input.overrideReason.trim();
  if (reason.length < SOD_OVERRIDE_REASON_MIN) {
    return {
      ok: false,
      error: `You are assigned to this NCR or wrote its corrective action. As an admin you may still close it, but give an override reason (at least ${SOD_OVERRIDE_REASON_MIN} characters).`,
    };
  }
  return { ok: true, override: reason };
}

export const RETURN_REASON_MIN = 10;

export function validateReturnReason(reason: string): string | null {
  return reason.trim().length >= RETURN_REASON_MIN
    ? null
    : `Give a reason for returning the NCR for rework (at least ${RETURN_REASON_MIN} characters).`;
}

export function severityLabel(severity: string): string {
  switch (severity) {
    case "major_ncr":
      return "Major NCR";
    case "minor_ncr":
      return "Minor NCR";
    case "observation":
      return "Issue";
    default:
      return severity.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
}

/** Describes a changed field for the audit trail; null when unchanged. */
export function diffField<T>(oldValue: T | null | undefined, newValue: T | null | undefined): { old: T | null; new: T | null } | null {
  const a = oldValue ?? null;
  const b = newValue ?? null;
  return a === b ? null : { old: a, new: b };
}
