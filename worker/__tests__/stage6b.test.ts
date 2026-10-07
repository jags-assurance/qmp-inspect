import { describe, it, expect } from "vitest";
import { ncrDossierFilingStatus, isRpcMissing } from "../src/jobs/vaultAutoFile";
import { isJobClaimable, retryDelayMs } from "../src/jobs/retryPolicy";
import { formatBookRevision } from "../src/jobs/dataBookTemplate";

describe("stage 6 leftovers", () => {
  it("files NCR dossiers as approved only when closed", () => {
    expect(ncrDossierFilingStatus("closed")).toBe("approved");
    expect(ncrDossierFilingStatus("open")).toBe("for_review");
    expect(ncrDossierFilingStatus(null)).toBe("for_review");
  });
  it("detects a missing RPC", () => {
    expect(isRpcMissing({ code: "42883" })).toBe(true);
    expect(isRpcMissing({ code: "PGRST202" })).toBe(true);
    expect(isRpcMissing({ code: "23505", message: "dup" })).toBe(false);
    expect(isRpcMissing(null)).toBe(false);
  });
  it("applies durable retry backoff from updated_at", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    expect(isJobClaimable({ attempts: 0, updated_at: "2026-10-07T12:00:00Z" }, now)).toBe(true);
    const recent = new Date(now - 1000).toISOString();
    expect(isJobClaimable({ attempts: 1, updated_at: recent }, now)).toBe(false);
    const old = new Date(now - retryDelayMs(1) - 1).toISOString();
    expect(isJobClaimable({ attempts: 1, updated_at: old }, now)).toBe(true);
  });
  it("prefers the persisted retry_not_before over the updated_at rule (S6-12)", () => {
    const now = Date.parse("2026-10-07T12:00:00Z");
    const longAgo = new Date(now - 3_600_000).toISOString();
    // updated_at alone would say claimable, but the persisted backoff has not elapsed.
    expect(isJobClaimable({ attempts: 2, updated_at: longAgo, retry_not_before: new Date(now + 60_000).toISOString() }, now)).toBe(false);
    expect(isJobClaimable({ attempts: 2, updated_at: longAgo, retry_not_before: new Date(now - 1).toISOString() }, now)).toBe(true);
    // Unparseable value falls back to the updated_at rule; fresh jobs are never delayed.
    expect(isJobClaimable({ attempts: 1, updated_at: longAgo, retry_not_before: "garbage" }, now)).toBe(true);
    expect(isJobClaimable({ attempts: 0, retry_not_before: new Date(now + 60_000).toISOString() }, now)).toBe(true);
  });
  it("formats the book revision", () => {
    expect(formatBookRevision(2)).toBe("Rev 2");
    expect(formatBookRevision(undefined)).toBe("Rev 0");
  });
});
