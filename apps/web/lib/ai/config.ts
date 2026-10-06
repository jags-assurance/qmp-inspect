// Single place for AI provider configuration: model names, timeouts, retry policy, output caps
// and the user-facing messages for a missing key / provider failure. Nothing else in the app
// should read GEMINI_* environment variables directly.

export type AiModelTier = "heavy" | "light";

// Defaults are used only when the env var is unset, so a deployment that sets GEMINI_API_KEY but
// forgets the model names still works rather than failing with an opaque error.
const DEFAULT_MODELS: Record<AiModelTier, string> = {
  heavy: "gemini-2.5-flash",
  light: "gemini-2.5-flash-lite",
};

export function aiModelFor(tier: AiModelTier): string {
  const fromEnv = tier === "heavy" ? process.env.GEMINI_MODEL_HEAVY : process.env.GEMINI_MODEL_LIGHT;
  return fromEnv?.trim() || DEFAULT_MODELS[tier];
}

/** Per-request timeout. The heavy tier produces a full multi-section ITP and legitimately takes longer. */
export const AI_TIMEOUT_MS: Record<AiModelTier, number> = {
  heavy: 120_000,
  light: 45_000,
};

/** One automatic retry for transient provider errors (429/5xx/timeout/network). */
export const AI_MAX_RETRIES = 1;
export const AI_RETRY_DELAY_MS = 1_500;

export const AI_MAX_OUTPUT_TOKENS: Record<AiModelTier, number> = {
  heavy: 16384,
  light: 4096,
};

// Organisation-level cost caps, enforced in lib/ai/gate.ts against ai_usage_log.
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;
export const AI_RATE_LIMIT_MAX_CALLS = 20;
export const AI_DAILY_MAX_CALLS = 1_000;

export const AI_KEY_MISSING_MESSAGE =
  "AI assistance is not configured on this server (no API key). Ask a JAGS administrator to set it up.";

export const AI_PROVIDER_BUSY_MESSAGE =
  "The AI service is busy or unavailable right now. Please try again in a minute.";
export const AI_PROVIDER_TIMEOUT_MESSAGE =
  "The AI service took too long to respond. Please try again, or use less source text.";
export const AI_EMPTY_OUTPUT_MESSAGE =
  "The AI service returned no usable result. Please try again, or add more detail to the input.";
export const AI_BAD_OUTPUT_MESSAGE =
  "The AI service returned a result in an unexpected format. Please try again.";

/** An error whose message is already safe to show directly to an end user. */
export class AiUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUserError";
  }
}

/** Message safe to show to a user for any thrown value from an AI call. */
export function aiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AiUserError) return err.message;
  return fallback;
}
