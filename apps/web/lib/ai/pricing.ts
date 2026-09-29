// Google AI (Gemini API) published list pricing — ai.google.dev/pricing, standard tier, per 1M
// tokens, text/document input. This is a cost ESTIMATE for internal visibility, not a billing
// figure: actual spend depends on the real contract (Vertex AI committed-use, promotional credits,
// currency), and Google revises list pricing from time to time. Matched by substring against
// whatever GEMINI_MODEL_HEAVY/LIGHT resolve to (e.g. "gemini-pro-latest", "gemini-2.5-flash") since
// this app calls the "-latest" alias, not a pinned dated model id.
//
// Pro and Flash tiers below also apply a long-context surcharge past 200k input tokens per Google's
// published tiering — included for completeness even though no feature in this app currently sends
// anywhere near that much (see MAX_COMBINED_SOURCE_CHARS in gemini-provider.ts).
interface PriceTier {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  longContextInputPerMillionUsd?: number;
  longContextOutputPerMillionUsd?: number;
  longContextThresholdTokens?: number;
}

const GEMINI_PRICING: { match: RegExp; label: string; tier: PriceTier }[] = [
  {
    match: /pro/i,
    label: "Gemini 2.5 Pro (or compatible \"-pro-\" alias)",
    tier: {
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 10.0,
      longContextInputPerMillionUsd: 2.5,
      longContextOutputPerMillionUsd: 15.0,
      longContextThresholdTokens: 200_000,
    },
  },
  {
    match: /flash-lite/i,
    label: "Gemini 2.5 Flash-Lite",
    tier: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  },
  {
    match: /flash/i,
    label: "Gemini 2.5 Flash (or compatible \"-flash-\" alias)",
    tier: { inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  },
];

export interface ModelCostEstimate {
  modelId: string;
  pricingLabel: string | null;
  costUsd: number | null;
}

/** Estimated USD cost of one call, given its real input/output token counts and which model
 *  produced it. Returns costUsd: null when either the model isn't recognized (no published rate on
 *  file) or the token counts themselves are unknown (e.g. logged before token tracking existed, or
 *  served from cache) — the caller should show that as "—", never as $0.00, since $0.00 would
 *  misleadingly read as "this call was free." */
export function estimateGeminiCallCostUsd(
  modelId: string | null,
  inputTokens: number | null,
  outputTokens: number | null
): ModelCostEstimate {
  if (!modelId) return { modelId: "unknown", pricingLabel: null, costUsd: null };

  const entry = GEMINI_PRICING.find((p) => p.match.test(modelId));
  if (!entry) return { modelId, pricingLabel: null, costUsd: null };
  if (inputTokens === null || outputTokens === null) {
    return { modelId, pricingLabel: entry.label, costUsd: null };
  }

  const { tier } = entry;
  const useLongContext =
    tier.longContextThresholdTokens !== undefined && inputTokens > tier.longContextThresholdTokens;
  const inputRate = useLongContext ? tier.longContextInputPerMillionUsd ?? tier.inputPerMillionUsd : tier.inputPerMillionUsd;
  const outputRate = useLongContext ? tier.longContextOutputPerMillionUsd ?? tier.outputPerMillionUsd : tier.outputPerMillionUsd;

  const costUsd = (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
  return { modelId, pricingLabel: entry.label, costUsd };
}

export function formatUsd(amount: number | null): string {
  if (amount === null) return "—";
  if (amount === 0) return "$0.00";
  if (amount < 0.01) return "<$0.01";
  return `$${amount.toFixed(2)}`;
}
