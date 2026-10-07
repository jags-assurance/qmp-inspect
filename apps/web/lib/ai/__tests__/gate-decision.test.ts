import { describe, expect, it } from "vitest";
import { consentConfirmationError, decideAiAccess, type AiGateInputs } from "../gate-decision";
import { AI_DAILY_MAX_CALLS, AI_RATE_LIMIT_MAX_CALLS } from "../config";

const ok: AiGateInputs = {
  keyConfigured: true,
  tier: "paid",
  organization: { ai_consent: true, is_active: true },
  recentCalls: 0,
  dailyCalls: 0,
};
const decide = (over: Partial<AiGateInputs>) => decideAiAccess({ ...ok, ...over });

describe("decideAiAccess", () => {
  it("allows a paid-tier, consenting, active organisation under the limits", () => {
    expect(decide({})).toEqual({ allowed: true, reason: null });
  });
  it("refuses without an API key or off the paid tier", () => {
    expect(decide({ keyConfigured: false }).allowed).toBe(false);
    expect(decide({ tier: undefined }).allowed).toBe(false);
    expect(decide({ tier: "free" }).allowed).toBe(false);
    expect(decide({ tier: "PAID" }).allowed).toBe(false);
  });
  it("needs consent to be exactly true", () => {
    expect(decide({ organization: { ai_consent: false, is_active: true } }).allowed).toBe(false);
    expect(decide({ organization: { ai_consent: null, is_active: true } }).allowed).toBe(false);
    expect(decide({ organization: null }).allowed).toBe(false);
  });
  it("refuses an inactive organisation even with consent", () => {
    expect(decide({ organization: { ai_consent: true, is_active: false } }).allowed).toBe(false);
  });
  it("fails closed when usage counts could not be read", () => {
    expect(decide({ recentCalls: null }).allowed).toBe(false);
    expect(decide({ dailyCalls: null }).allowed).toBe(false);
  });
  it("enforces the rate and daily limits", () => {
    expect(decide({ recentCalls: AI_RATE_LIMIT_MAX_CALLS - 1 }).allowed).toBe(true);
    expect(decide({ recentCalls: AI_RATE_LIMIT_MAX_CALLS }).allowed).toBe(false);
    expect(decide({ dailyCalls: AI_DAILY_MAX_CALLS }).allowed).toBe(false);
  });
});

describe("consentConfirmationError", () => {
  it("only asks for confirmation when enabling, and matches the slug case-insensitively", () => {
    expect(consentConfirmationError(false, "acme", "")).toBeNull();
    expect(consentConfirmationError(true, "acme", "")).toMatch(/acme/);
    expect(consentConfirmationError(true, "acme", " ACME ")).toBeNull();
    expect(consentConfirmationError(true, "acme", "acm")).not.toBeNull();
    expect(consentConfirmationError(true, "", "")).not.toBeNull();
  });
});
