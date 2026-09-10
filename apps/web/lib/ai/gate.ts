import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The single enforcement point for the non-negotiable data-privacy rule: an organisation's real
 * content may only ever be sent to the AI provider when BOTH (a) this deployment is on the paid
 * Gemini tier (AI_TIER=paid) and (b) that organisation has explicitly opted in (ai_consent = true).
 * On the free tier — as in this dev environment — Google's terms allow training on submitted
 * content, so no real org data may be sent regardless of consent.
 *
 * Every AI-calling server action must call this FIRST, before building any prompt — never as an
 * afterthought once a prompt already exists. Returns a result object rather than throwing so call
 * sites can render a plain, non-crashing "AI is not available yet" state instead of an error page.
 */
export interface AiGateResult {
  allowed: boolean;
  reason: string | null;
}

export async function assertAiAllowed(
  supabase: SupabaseClient,
  organizationId: string
): Promise<AiGateResult> {
  if (process.env.AI_TIER !== "paid") {
    return {
      allowed: false,
      reason:
        "AI assistance is not available in this environment yet (dev/free tier — real project data is never sent to the AI provider on this tier).",
    };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("ai_consent")
    .eq("id", organizationId)
    .maybeSingle<{ ai_consent: boolean }>();

  if (!organization?.ai_consent) {
    return {
      allowed: false,
      reason:
        "AI assistance is not available for this organisation yet. A JAGS admin can enable it once the account is on the paid tier.",
    };
  }

  return { allowed: true, reason: null };
}
