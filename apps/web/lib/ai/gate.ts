import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_USAGE_LOG_TABLE } from "@/lib/ai/log";
import {
  AI_DAILY_MAX_CALLS,
  AI_KEY_MISSING_MESSAGE,
  AI_RATE_LIMIT_MAX_CALLS,
  AI_RATE_LIMIT_WINDOW_MS,
} from "@/lib/ai/config";

// Cheap abuse guard on top of the consent gate below: caps how many AI calls one organisation can
// make in a rolling window, using the usage log that already exists for admin-visibility purposes
// (lib/ai/log.ts) rather than a new table or an in-memory counter — a DB-backed count survives a
// restart/redeploy and is correct even if this app ever runs more than one instance, unlike an
// in-process Map would be. Not per-user: an org sharing its seat across staff shouldn't be able to
// bypass the cap by spreading calls across accounts.

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

/**
 * R43 — "AI features are hidden cleanly if no AI API key is configured." This is deliberately
 * separate from assertAiAllowed: that gate is about whether THIS organisation may use AI right now
 * (tier + consent + rate limit) and is meant to be called from a server action, returning a friendly
 * error after the user has already tried to submit. This one is for deciding, at render time in a
 * server component, whether to show an AI entry point (a tab, a button) at all — so a deployment
 * with no key configured never shows a control that can only ever fail.
 */
export function isAiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function assertAiAllowed(
  supabase: SupabaseClient,
  organizationId: string
): Promise<AiGateResult> {
  if (!isAiConfigured()) {
    return { allowed: false, reason: AI_KEY_MISSING_MESSAGE };
  }

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

  const { count: recentCalls } = await supabase
    .from(AI_USAGE_LOG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", new Date(Date.now() - AI_RATE_LIMIT_WINDOW_MS).toISOString());

  if ((recentCalls ?? 0) >= AI_RATE_LIMIT_MAX_CALLS) {
    return {
      allowed: false,
      reason: "AI assistance is being used heavily right now — please wait a moment and try again.",
    };
  }

  // Daily cost ceiling per organisation (cache hits are logged too, so they count - deliberately
  // conservative).
  const { count: dailyCalls } = await supabase
    .from(AI_USAGE_LOG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if ((dailyCalls ?? 0) >= AI_DAILY_MAX_CALLS) {
    return {
      allowed: false,
      reason: "This organisation has reached its daily AI usage limit. It resets on a rolling 24-hour basis.",
    };
  }

  return { allowed: true, reason: null };
}
