import { describe, it, expect } from "vitest";
import { isRpcMissing, parseClaimRpcResult, replicaId, sweepLeaseSeconds } from "../src/jobs/claim";
import { isJobClaimable, retryDelayMs } from "../src/jobs/retryPolicy";

describe("isRpcMissing", () => {
  it("recognises an uninstalled function", () => {
    expect(isRpcMissing({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isRpcMissing({ code: "42883", message: "x" })).toBe(true);
    expect(isRpcMissing({ message: "Could not find the function public.claim_next_background_job without parameters in the schema cache" })).toBe(true);
    expect(isRpcMissing({ message: 'function public.try_acquire_worker_lease(text) does not exist' })).toBe(true);
  });
  it("does not treat other failures as missing", () => {
    expect(isRpcMissing(null)).toBe(false);
    expect(isRpcMissing(undefined)).toBe(false);
    expect(isRpcMissing({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isRpcMissing({ message: "fetch failed" })).toBe(false);
  });
});

describe("parseClaimRpcResult", () => {
  const row = { id: "job-1", status: "processing", attempts: 1 };
  it("takes the first row of a setof result", () => {
    expect(parseClaimRpcResult([row])).toBe(row);
  });
  it("accepts a bare object", () => {
    expect(parseClaimRpcResult(row)).toBe(row);
  });
  it("returns null when nothing was claimed", () => {
    expect(parseClaimRpcResult([])).toBeNull();
    expect(parseClaimRpcResult(null)).toBeNull();
    expect(parseClaimRpcResult(undefined)).toBeNull();
    expect(parseClaimRpcResult("nope")).toBeNull();
    expect(parseClaimRpcResult([{ status: "processing" }])).toBeNull();
  });
});

describe("replicaId", () => {
  it("prefers an explicit replica id and always includes the pid", () => {
    expect(replicaId({ RAILWAY_REPLICA_ID: "rep-2" }, "host", 41)).toBe("rep-2:41");
    expect(replicaId({ REPLICA_ID: "r9" }, "host", 7)).toBe("r9:7");
  });
  it("falls back to the hostname", () => {
    expect(replicaId({}, "box", 5)).toBe("box:5");
    expect(replicaId({ RAILWAY_REPLICA_ID: "" }, "box", 5)).toBe("box:5");
  });
});

describe("sweepLeaseSeconds", () => {
  it("is a bit shorter than the interval so the next run can acquire it", () => {
    expect(sweepLeaseSeconds(900_000)).toBe(720);
  });
  it("never goes below 30s", () => {
    expect(sweepLeaseSeconds(1000)).toBe(30);
  });
});

// The SQL in 20261111000103 mirrors isJobClaimable; these pin the shared rule so the two stay in step.
describe("backoff rule shared with claim_next_background_job()", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  it("fresh jobs are always claimable", () => {
    expect(isJobClaimable({ attempts: 0 }, now)).toBe(true);
  });
  it("retry_not_before is authoritative when present", () => {
    expect(isJobClaimable({ attempts: 1, retry_not_before: "2026-11-11T12:00:01Z", updated_at: "2026-11-11T10:00:00Z" }, now)).toBe(false);
    expect(isJobClaimable({ attempts: 1, retry_not_before: "2026-11-11T11:59:59Z", updated_at: "2026-11-11T11:59:59Z" }, now)).toBe(true);
  });
  it("without retry_not_before it waits updated_at + backoff (30s, 2m, 8m, cap 15m)", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(480_000);
    expect(retryDelayMs(6)).toBe(15 * 60_000);
    expect(isJobClaimable({ attempts: 1, updated_at: new Date(now - 29_000).toISOString() }, now)).toBe(false);
    expect(isJobClaimable({ attempts: 1, updated_at: new Date(now - 31_000).toISOString() }, now)).toBe(true);
  });
});
