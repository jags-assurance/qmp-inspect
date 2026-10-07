import { AI_DAILY_MAX_CALLS, AI_KEY_MISSING_MESSAGE, AI_RATE_LIMIT_MAX_CALLS } from "@/lib/ai/config";

/**
 * E-09: the pure decision behind assertAiAllowed (lib/ai/gate.ts). Every input is something the gate had to
 * read; any input that could not be read is passed as null and FAILS CLOSED, so a database hiccup can never
 * turn into "AI allowed". Order matters: the cheapest, most fundamental refusals come first.
 */
export interface AiGateInputs {
  keyConfigured: boolean;
  tier: string | undefined;
  /** null = the organisation row could not be read (or does not exist). */
  organization: { ai_consent: boolean | null; is_active: boolean | null } | null;
  /** null = the count query failed. */
  recentCalls: number | null;
  /** null = the count query failed. */
  dailyCalls: number | null;
}

export interface AiGateDecision {
  allowed: boolean;
  reason: string | null;
}

const deny = (reason: string): AiGateDecision => ({ allowed: false, reason });

export function decideAiAccess(input: AiGateInputs): AiGateDecision {
  if (!input.keyConfigured) return deny(AI_KEY_MISSING_MESSAGE);

  if (input.tier !== "paid") {
    return deny(
      "AI assistance is not available in this environment yet (dev/free tier — real project data is never sent to the AI provider on this tier)."
    );
  }

  // Strictly `true`: null / undefined / anything else is "no consent".
  if (!input.organization || input.organization.ai_consent !== true) {
    return deny("AI assistance is not available for this organisation yet. A JAGS admin can enable it once the account is on the paid tier.");
  }
  // A deactivated organisation's data is not sent anywhere, whatever its stored consent says.
  if (input.organization.is_active === false) {
    return deny("This organisation is inactive, so AI assistance is not available.");
  }

  if (input.recentCalls === null || input.dailyCalls === null) {
    return deny("AI assistance could not check its usage limits just now — please try again in a moment.");
  }
  if (input.recentCalls >= AI_RATE_LIMIT_MAX_CALLS) {
    return deny("AI assistance is being used heavily right now — please wait a moment and try again.");
  }
  if (input.dailyCalls >= AI_DAILY_MAX_CALLS) {
    return deny("This organisation has reached its daily AI usage limit. It resets on a rolling 24-hour basis.");
  }

  return { allowed: true, reason: null };
}

/**
 * Switching consent ON must be deliberate: the admin types the organisation's slug to confirm. Switching it
 * OFF never needs confirmation (withdrawing consent is always immediate). Returns an error message or null.
 */
export function consentConfirmationError(enable: boolean, orgSlug: string, typed: string): string | null {
  if (!enable) return null;
  if (typed.trim().toLowerCase() !== orgSlug.trim().toLowerCase() || !orgSlug.trim()) {
    return `Type the organisation's short name (${orgSlug}) to confirm that its content may be sent to the AI provider.`;
  }
  return null;
}
