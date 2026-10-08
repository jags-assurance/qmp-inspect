import { describe, expect, it } from "vitest";
import { bannerLine, isPrintStatus, itpIssueDate } from "../print-banner";

describe("print banner", () => {
  it("accepts superseded and withdrawn as print filters", () => {
    for (const s of ["draft", "under_review", "approved", "client_accepted", "superseded", "withdrawn"]) expect(isPrintStatus(s)).toBe(true);
    expect(isPrintStatus("bogus")).toBe(false);
    expect(isPrintStatus(undefined)).toBe(false);
  });
  it("shows revision, status and date for each ITP", () => {
    expect(bannerLine({ itp_number: "ITP-001", revision: 3, status: "superseded", approved_at: "2026-09-02T10:00:00Z", updated_at: "2026-10-01T00:00:00Z" })).toBe(
      "ITP-001 · Rev 3 · Superseded · 02/09/2026"
    );
  });
  it("falls back to updated_at, then a dash", () => {
    expect(itpIssueDate({ approved_at: null, updated_at: "2026-10-01T00:00:00Z" })).toBe("01/10/2026");
    expect(itpIssueDate({ approved_at: null, updated_at: null })).toBe("—");
  });
});
