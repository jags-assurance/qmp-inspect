import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimits } from "../rate-limit";

const rule = { limit: 3, windowMs: 1000 };

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit then blocks with a retry hint", () => {
    expect(checkRateLimit("b", "u1", rule, 0).ok).toBe(true);
    expect(checkRateLimit("b", "u1", rule, 100).ok).toBe(true);
    expect(checkRateLimit("b", "u1", rule, 200).ok).toBe(true);
    const blocked = checkRateLimit("b", "u1", rule, 300);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
  });

  it("recovers once the window slides past old hits", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("b", "u1", rule, i);
    expect(checkRateLimit("b", "u1", rule, 500).ok).toBe(false);
    expect(checkRateLimit("b", "u1", rule, 1100).ok).toBe(true);
  });

  it("keeps users and buckets independent", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("b", "u1", rule, i);
    expect(checkRateLimit("b", "u2", rule, 10).ok).toBe(true);
    expect(checkRateLimit("other", "u1", rule, 10).ok).toBe(true);
  });
});
