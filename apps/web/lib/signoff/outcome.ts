// S4-18: sign-off comment and reject outcome. Pure validation, unit-tested.

export const MAX_SIGNOFF_TEXT = 1000;
export const MIN_REJECTION_REASON_LENGTH = 10;

/** Optional comment recorded with a sign-off. Blank is fine (null). */
export function normaliseSignoffComment(raw: string | null | undefined): { value: string | null } | { error: string } {
  const text = (raw ?? "").trim();
  if (!text) return { value: null };
  if (text.length > MAX_SIGNOFF_TEXT) return { error: `The comment is too long (max ${MAX_SIGNOFF_TEXT} characters).` };
  return { value: text };
}

/** A rejection always needs a written reason. */
export function validateRejectionReason(raw: string | null | undefined): { value: string } | { error: string } {
  const text = (raw ?? "").trim();
  if (text.length < MIN_REJECTION_REASON_LENGTH) {
    return { error: `Give a reason for rejecting (at least ${MIN_REJECTION_REASON_LENGTH} characters) so the inspector knows what to fix.` };
  }
  if (text.length > MAX_SIGNOFF_TEXT) return { error: `The reason is too long (max ${MAX_SIGNOFF_TEXT} characters).` };
  return { value: text };
}

/** Statuses a party may reject from: not yet released. A recorded release is withdrawn, not rejected. */
export function canRejectFromStatus(status: string): boolean {
  return status === "pending" || status === "notified";
}
