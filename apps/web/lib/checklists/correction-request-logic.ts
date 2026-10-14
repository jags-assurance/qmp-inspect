// Pure helpers for correction requests (site-execution audit M7).
export const CORRECTION_REASON_MIN = 10;
export const CORRECTION_NOTE_MIN = 5;
export const CORRECTION_MAX = 1000;

export type CorrectionRequestStatus = "open" | "approved" | "declined";

export function validateCorrectionReason(reason: string): string | null {
  const r = reason.trim();
  if (r.length < CORRECTION_REASON_MIN) return `Give a reason for the correction (at least ${CORRECTION_REASON_MIN} characters).`;
  if (r.length > CORRECTION_MAX) return `The reason is too long (max ${CORRECTION_MAX} characters).`;
  return null;
}

/** Team leads and admins, de-duplicated, never the person acting. */
export function pickCorrectionRecipients(teamLeadIds: string[], adminIds: string[], actorId: string | null | undefined): string[] {
  return [...new Set([...teamLeadIds, ...adminIds])].filter((id) => id && id !== actorId);
}

/** The reason passed to the existing reopen / withdraw path (reopen needs at least 15 characters). */
export function approvalReason(requesterName: string | null, reason: string): string {
  return `Correction requested${requesterName ? ` by ${requesterName}` : ""}: ${reason.trim()}`.slice(0, 1000);
}
