import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_RATE_LIMITS,
  buildRateLimitKeys,
  checkSharedRateLimit,
  clientIpFromHeaders,
  resetRateLimits,
  resetSharedRateLimitWarning,
  SHARED_BUCKETS,
} from "../rate-limit";

describe("shared rate limit policy", () => {
  beforeEach(() => {
    resetRateLimits();
    resetSharedRateLimitWarning();
  });

  it("builds per-user and per-IP keys, skipping unknowns", () => {
    expect(buildRateLimitKeys("export", "u1", "1.2.3.4")).toEqual(["export:u:u1", "export:ip:1.2.3.4"]);
    expect(buildRateLimitKeys("export", null, "1.2.3.4")).toEqual(["export:ip:1.2.3.4"]);
    expect(buildRateLimitKeys("export", "u1", null)).toEqual(["export:u:u1"]);
  });

  it("reads the first forwarded IP", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });

  it("heavy classes are configured and shared; offline sync is not", () => {
    for (const b of ["export", "bulkDownload", "pdf", "ai", "handover", "emailInbound", "authAttempt"] as const) {
      expect(SHARED_BUCKETS.has(b)).toBe(true);
      expect(API_RATE_LIMITS[b].limit).toBeGreaterThan(0);
    }
    expect(SHARED_BUCKETS.has("offlineSync")).toBe(false);
  });

  it("blocks when the shared counter says over budget, with the window as retry hint", async () => {
    const rpc = vi.fn().mockResolvedValue(false);
    const r = await checkSharedRateLimit("bulkDownload", "u1", "1.1.1.1", rpc);
    expect(r).toEqual({ ok: false, retryAfterSec: 600 });
    expect(rpc).toHaveBeenCalledWith("bulkDownload:u:u1", 5, 600);
  });

  it("gives the IP key a larger budget", async () => {
    const rpc = vi.fn().mockResolvedValue(true);
    await checkSharedRateLimit("export", "u1", "1.1.1.1", rpc);
    expect(rpc).toHaveBeenCalledWith("export:ip:1.1.1.1", API_RATE_LIMITS.export.limit * 5, 60);
  });

  it("does not call the RPC for non-shared buckets", async () => {
    const rpc = vi.fn().mockResolvedValue(false);
    expect((await checkSharedRateLimit("offlineSync", "u1", "1.1.1.1", rpc)).ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails open on RPC errors and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn().mockRejectedValue(new Error("function does not exist"));
    expect((await checkSharedRateLimit("export", "u1", null, rpc)).ok).toBe(true);
    expect((await checkSharedRateLimit("export", "u1", null, rpc)).ok).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("still enforces the in-memory limit when the RPC is down", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn().mockRejectedValue(new Error("down"));
    for (let i = 0; i < API_RATE_LIMITS.bulkDownload.limit; i++) await checkSharedRateLimit("bulkDownload", "u2", null, rpc);
    expect((await checkSharedRateLimit("bulkDownload", "u2", null, rpc)).ok).toBe(false);
  });
});
