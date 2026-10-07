// Pure decision for who may record a sign-off for a party (see signOffAction in ./actions.ts).
// Kept free of Supabase so it can be unit-tested.

export const ON_BEHALF_REASON_PREFIX = "A reason is required to sign on behalf of a party";
export const MIN_ON_BEHALF_REASON_LENGTH = 10;

export interface SignoffAuthorityInput {
  isJagsStaff: boolean;
  /** Admin staff or a lead of a team assigned to the project. */
  isAdminOrTeamLead: boolean;
  /** The signer's own login is linked to this (active) party. */
  isLinkedActiveParty: boolean;
  reason: string;
}

export type SignoffAuthority = { allowed: true; onBehalf: boolean; reason: string | null } | { allowed: false; error: string };

export function evaluateSignoffAuthority(input: SignoffAuthorityInput): SignoffAuthority {
  if (input.isLinkedActiveParty) return { allowed: true, onBehalf: false, reason: null };
  if (!input.isJagsStaff) return { allowed: false, error: "You can only sign off on behalf of your own party on this project." };
  if (!input.isAdminOrTeamLead) {
    return { allowed: false, error: "Only an admin or team lead can sign on behalf of a party; ask the party to sign for themselves." };
  }
  const reason = input.reason.trim();
  if (reason.length < MIN_ON_BEHALF_REASON_LENGTH) {
    return { allowed: false, error: `${ON_BEHALF_REASON_PREFIX} (at least ${MIN_ON_BEHALF_REASON_LENGTH} characters).` };
  }
  return { allowed: true, onBehalf: true, reason };
}
