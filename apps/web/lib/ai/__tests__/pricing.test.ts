import { describe, expect, it } from "vitest";
import { estimateGeminiCallCostUsd, formatUsd } from "../pricing";
import { FEATURE_CATEGORY, FEATURE_LABEL } from "../feature-categories";

describe("estimateGeminiCallCostUsd", () => {
  it("prices a Pro call at the standard tier", () => {
    const r = estimateGeminiCallCostUsd("gemini-pro-latest", 100_000, 100_000);
    // 0.1M in * $1.25 + 0.1M out * $10 = 1.125
    expect(r.costUsd).toBeCloseTo(1.125, 10);
    expect(r.pricingLabel).toMatch(/Pro/);
  });

  it("switches Pro to the long-context rate only above 200k input tokens", () => {
    const atThreshold = estimateGeminiCallCostUsd("gemini-2.5-pro", 200_000, 0);
    expect(atThreshold.costUsd).toBeCloseTo(0.2 * 1.25, 10);
    const above = estimateGeminiCallCostUsd("gemini-2.5-pro", 200_001, 1_000_000);
    expect(above.costUsd).toBeCloseTo((200_001 / 1_000_000) * 2.5 + 15, 10);
  });

  it("prices Flash and Flash-Lite separately (flash-lite must not fall through to Flash)", () => {
    const flash = estimateGeminiCallCostUsd("gemini-2.5-flash", 1_000_000, 1_000_000);
    expect(flash.costUsd).toBeCloseTo(0.3 + 2.5, 10);
    const lite = estimateGeminiCallCostUsd("gemini-2.5-flash-lite", 1_000_000, 1_000_000);
    expect(lite.costUsd).toBeCloseTo(0.1 + 0.4, 10);
    expect(lite.pricingLabel).toMatch(/Flash-Lite/);
  });

  it("returns null cost (never zero) when the model is unknown or missing", () => {
    expect(estimateGeminiCallCostUsd(null, 10, 10)).toEqual({ modelId: "unknown", pricingLabel: null, costUsd: null });
    expect(estimateGeminiCallCostUsd("some-other-model", 10, 10)).toEqual({
      modelId: "some-other-model",
      pricingLabel: null,
      costUsd: null,
    });
  });

  it("returns null cost when token counts are unknown, but still labels the model", () => {
    const r = estimateGeminiCallCostUsd("gemini-flash-latest", null, 50);
    expect(r.costUsd).toBeNull();
    expect(r.pricingLabel).toMatch(/Flash/);
    expect(estimateGeminiCallCostUsd("gemini-flash-latest", 50, null).costUsd).toBeNull();
  });

  it("treats a real zero-token call as a cost of exactly 0", () => {
    expect(estimateGeminiCallCostUsd("gemini-flash-latest", 0, 0).costUsd).toBe(0);
  });
});

describe("formatUsd", () => {
  it("shows a dash for unknown, never $0.00", () => {
    expect(formatUsd(null)).toBe("—");
  });

  it("distinguishes exactly zero from a tiny non-zero amount", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.004)).toBe("<$0.01");
  });

  it("formats to two decimals", () => {
    expect(formatUsd(0.01)).toBe("$0.01");
    expect(formatUsd(1.236)).toBe("$1.24");
    expect(formatUsd(1234.5)).toBe("$1234.50");
  });
});

describe("AI feature tables", () => {
  it("categorise and label exactly the same set of features", () => {
    expect(Object.keys(FEATURE_LABEL).sort()).toEqual(Object.keys(FEATURE_CATEGORY).sort());
  });

  it("use only the four documented categories and non-empty labels", () => {
    const allowed = new Set(["Drafting & Generation", "Extraction", "Review & Suggestions", "Translation & Cleanup"]);
    for (const category of Object.values(FEATURE_CATEGORY)) expect(allowed.has(category)).toBe(true);
    for (const label of Object.values(FEATURE_LABEL)) expect(label.trim().length).toBeGreaterThan(0);
  });
});
