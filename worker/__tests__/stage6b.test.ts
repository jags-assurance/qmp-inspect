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
  it("formats the book revision", () => {
    expect(formatBookRevision(2)).toBe("Rev 2");
    expect(formatBookRevision(undefined)).toBe("Rev 0");
  });
});
