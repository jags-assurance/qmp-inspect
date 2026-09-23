import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_USAGE_LOG_TABLE, type AiFeature } from "./log";

/**
 * Deterministic cache key for one AI call's grounding input. Callers pass whatever uniquely
 * determines the output for that feature — a plain string (already-trimmed source text) where one
 * exists, or a small object with a FIXED, hand-written key order (e.g. `{ text, targetLanguage }`)
 * when more than one input dimension affects the result; JSON.stringify only produces a stable
 * string across calls when the object's own key order is stable, so this deliberately does not try
 * to canonicalize an arbitrary object itself.
 */
export function hashAiCacheInput(input: string | Record<string, unknown>): string {
  const normalized = typeof input === "string" ? input.trim() : JSON.stringify(input);
  return createHash("sha256").update(normalized).digest("hex");
}

export interface AiCacheLookupParams {
  organizationId: string;
  feature: AiFeature;
  promptVersion: string;
  inputHash: string;
}

/**
 * Looks for a previous ai_usage_log row for this exact (organisation, feature, prompt version,
 * input hash) combination and returns its stored ai_response if found, else null.
 *
 * Why this is safe to reuse rather than re-generate: every feature that writes AI output into a
 * real record already requires an explicit human review/confirm step before it takes effect (see
 * recordAiReviewDecision's own doc comment) — a cache hit changes WHEN the text was produced, never
 * whether a person reviews it before it's used anywhere. Scoped by promptVersion too, so bumping a
 * feature's PROMPT_VERSIONS entry (gemini-provider.ts) for a wording change naturally invalidates
 * every prior cache entry for it — nothing to remember to clear by hand. Scoped per-organization
 * (never shared across tenants), even though the cached content itself carries no cross-tenant
 * secret, simply to keep this app's "tenant isolation is absolute" rule true of every table without
 * a carved-out exception.
 *
 * Best-effort: a lookup failure (RLS edge case, transient error) just means "no cache hit" — it
 * never blocks or fails the caller, which falls back to a fresh generation exactly as it did before
 * caching existed.
 */
export async function findCachedAiResponse<T>(
  supabase: SupabaseClient,
  params: AiCacheLookupParams
): Promise<T | null> {
  try {
    const { data } = await supabase
      .from(AI_USAGE_LOG_TABLE)
      .select("ai_response")
      .eq("organization_id", params.organizationId)
      .eq("feature", params.feature)
      .eq("prompt_version", params.promptVersion)
      .eq("input_hash", params.inputHash)
      .not("ai_response", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ ai_response: T }>();

    return data ? data.ai_response : null;
  } catch {
    return null;
  }
}
