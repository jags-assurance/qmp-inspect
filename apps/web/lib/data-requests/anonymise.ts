// Shared constants for the anonymisation flow. Kept in a plain module (not "use server") so the client
// dialog, the server action and the tests all read the same values.

export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 500;
export const ANONYMISED_EMAIL_DOMAIN = "anonymised.invalid";
export const FORMER_USER_NAME = "Former user";

/** The placeholder email anonymise_user() writes (must match the SQL function). */
export function anonymisedEmail(userId: string): string {
  return `anonymised-${userId}@${ANONYMISED_EMAIL_DOMAIN}`;
}

export function isAnonymisedEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${ANONYMISED_EMAIL_DOMAIN}`);
}
