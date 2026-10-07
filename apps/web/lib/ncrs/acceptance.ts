// S5-22: client acceptance of an NCR disposition. Pure rules, unit-tested.
// Columns come from supabase/migrations/20261110000400_ncr_client_acceptance.sql.

export const CLIENT_ACCEPTANCE_DECISIONS = ["accepted", "rejected"] as const;
export type ClientAcceptanceDecision = (typeof CLIENT_ACCEPTANCE_DECISIONS)[number];

export const ACCEPTANCE_COMMENT_MIN = 5;
export const ACCEPTANCE_COMMENT_MAX = 1000;

/** Dispositions that normally need the client's say: the work is not simply put right to spec. */
export const DISPOSITIONS_NEEDING_CLIENT = ["use_as_is", "concession", "repair"] as const;

export function dispositionSuggestsClientAcceptance(disposition: string | null | undefined): boolean {
  return !!disposition && (DISPOSITIONS_NEEDING_CLIENT as readonly string[]).includes(disposition);
}

export function validateAcceptanceInput(decisionRaw: string, commentRaw: string): { decision: ClientAcceptanceDecision; comment: string | null } | { error: string } {
  const decision = decisionRaw.trim();
  if (!(CLIENT_ACCEPTANCE_DECISIONS as readonly string[]).includes(decision)) return { error: "Choose accept or reject." };
  const comment = commentRaw.trim();
  if (comment.length > ACCEPTANCE_COMMENT_MAX) return { error: `The comment is too long (max ${ACCEPTANCE_COMMENT_MAX} characters).` };
  if (decision === "rejected" && comment.length < ACCEPTANCE_COMMENT_MIN) {
    return { error: `Say why the disposition is rejected (at least ${ACCEPTANCE_COMMENT_MIN} characters).` };
  }
  return { decision: decision as ClientAcceptanceDecision, comment: comment || null };
}

export function canRecordClientAcceptance(input: {
  isAdminStaff: boolean;
  isClientPartyUser: boolean;
  required: boolean;
  status: string;
  withdrawn: boolean;
  /** The disposition the client is accepting; it must exist. */
  disposition: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (!input.required) return { ok: false, error: "Client acceptance is not required on this NCR." };
  if (input.withdrawn) return { ok: false, error: "This NCR was withdrawn." };
  if (!input.disposition) return { ok: false, error: "Record the disposition before the client can accept it." };
  if (!input.isAdminStaff && !input.isClientPartyUser) {
    return { ok: false, error: "Only the client's own login (or a JAGS admin on their behalf) can record this." };
  }
  if (input.status === "open") return { ok: false, error: "The NCR has not been worked yet." };
  return { ok: true };
}

/** Closing is held until the client has accepted when acceptance was required. */
export function acceptanceBlocksClose(required: boolean | null | undefined, decision: string | null | undefined): string | null {
  if (!required) return null;
  if (decision === "accepted") return null;
  if (decision === "rejected") return "The client rejected the disposition. Revise the disposition and ask for acceptance again before closing.";
  return "The client has to accept the disposition before this NCR can be closed.";
}
