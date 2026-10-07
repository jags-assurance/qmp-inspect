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
}

/** Who may work the NCR (CAPA text, evidence, quick status moves). */
export function canWorkNcr(ctx: NcrActorContext): boolean {
  return (
    ctx.isStaff ||
    ctx.raisedBy === ctx.userId ||
    ctx.assignedTo === ctx.userId ||
    (!!ctx.partyUserId && ctx.partyUserId === ctx.userId)
  );
}

/** Assignment, due date and responsible party are staff-or-raiser only. */
export function canEditAssignment(ctx: Pick<NcrActorContext, "isStaff" | "userId" | "raisedBy">): boolean {
  return ctx.isStaff || ctx.raisedBy === ctx.userId;
}

/** CAPA text is locked for non-staff once the NCR awaits verification. */
export function canEditCapa(status: string, isStaff: boolean): boolean {
  if (status === "closed") return false;
  if (status === "pending_verification") return isStaff;
  return true;
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
      return "Observation";
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
