import { describe, expect, it } from "vitest";
import {
  acceptanceBlocksClose,
  canRecordClientAcceptance,
  dispositionSuggestsClientAcceptance,
  validateAcceptanceInput,
} from "../acceptance";
import { buildVendorScorecard, type ScorecardNcr } from "../scorecard";

describe("validateAcceptanceInput", () => {
  it("accepts with or without a comment", () => {
    expect(validateAcceptanceInput("accepted", "")).toEqual({ decision: "accepted", comment: null });
    expect(validateAcceptanceInput("accepted", " fine ")).toEqual({ decision: "accepted", comment: "fine" });
  });
  it("a rejection needs a reason", () => {
    expect("error" in validateAcceptanceInput("rejected", "no")).toBe(true);
    expect(validateAcceptanceInput("rejected", "Not acceptable per spec")).toEqual({ decision: "rejected", comment: "Not acceptable per spec" });
  });
  it("rejects unknown decisions", () => {
    expect("error" in validateAcceptanceInput("maybe", "")).toBe(true);
  });
});

describe("canRecordClientAcceptance", () => {
  const base = { isAdminStaff: false, isClientPartyUser: true, required: true, status: "pending_verification", withdrawn: false, disposition: "use_as_is" };
  it("allows the client user", () => {
    expect(canRecordClientAcceptance(base)).toEqual({ ok: true });
  });
  it("refuses others, withdrawn, not required, no disposition", () => {
    expect(canRecordClientAcceptance({ ...base, isClientPartyUser: false }).ok).toBe(false);
    expect(canRecordClientAcceptance({ ...base, withdrawn: true }).ok).toBe(false);
    expect(canRecordClientAcceptance({ ...base, required: false }).ok).toBe(false);
    expect(canRecordClientAcceptance({ ...base, disposition: null }).ok).toBe(false);
    expect(canRecordClientAcceptance({ ...base, status: "open" }).ok).toBe(false);
  });
  it("lets an admin act for the client", () => {
    expect(canRecordClientAcceptance({ ...base, isClientPartyUser: false, isAdminStaff: true }).ok).toBe(true);
  });
});

describe("acceptanceBlocksClose / dispositionSuggestsClientAcceptance", () => {
  it("only blocks when required and not accepted", () => {
    expect(acceptanceBlocksClose(false, null)).toBeNull();
    expect(acceptanceBlocksClose(null, null)).toBeNull();
    expect(acceptanceBlocksClose(true, "accepted")).toBeNull();
    expect(acceptanceBlocksClose(true, null)).toMatch(/has to accept/);
    expect(acceptanceBlocksClose(true, "rejected")).toMatch(/rejected/);
  });
  it("flags dispositions that leave the work not to spec", () => {
    expect(dispositionSuggestsClientAcceptance("use_as_is")).toBe(true);
    expect(dispositionSuggestsClientAcceptance("rework")).toBe(false);
    expect(dispositionSuggestsClientAcceptance(null)).toBe(false);
  });
});

describe("buildVendorScorecard", () => {
  const rows: ScorecardNcr[] = [
    { responsible_party_id: "a", severity: "major_ncr", status: "closed", created_at: "2026-01-01T00:00:00Z", closed_at: "2026-01-11T00:00:00Z", due_date: "2026-01-15" },
    { responsible_party_id: "a", severity: "minor_ncr", status: "open", created_at: "2026-02-01T00:00:00Z", closed_at: null, due_date: "2026-02-10" },
    { responsible_party_id: "a", severity: "minor_ncr", status: "closed", created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-20T00:00:00Z", due_date: "2026-03-10", reopen_count: 1 },
    { responsible_party_id: "a", severity: "minor_ncr", status: "closed", created_at: "2026-03-01T00:00:00Z", closed_at: "2026-03-02T00:00:00Z", due_date: null, withdrawn_at: "2026-03-02T00:00:00Z" },
    { responsible_party_id: null, severity: "minor_ncr", status: "open", created_at: "2026-03-01T00:00:00Z", closed_at: null, due_date: null },
    { responsible_party_id: "b", severity: "observation", status: "open", created_at: "2026-03-01T00:00:00Z", closed_at: null, due_date: null },
  ];
  it("aggregates per party, excluding withdrawn and observations", () => {
    const out = buildVendorScorecard(rows, "2026-06-01");
    const a = out.find((s) => s.partyId === "a")!;
    expect(a.total).toBe(3);
    expect(a.open).toBe(1);
    expect(a.closed).toBe(2);
    expect(a.major).toBe(1);
    expect(a.overdue).toBe(1);
    expect(a.reopened).toBe(1);
    expect(a.avgDaysToClose).toBe(14.5);
    expect(a.onTimeRate).toBe(50);
    expect(out.find((s) => s.partyId === "b")).toBeUndefined();
    expect(out.find((s) => s.partyId === null)?.total).toBe(1);
  });
  it("sorts the worst vendor first", () => {
    expect(buildVendorScorecard(rows, "2026-06-01")[0].partyId).toBe("a");
  });
  it("handles empty input", () => {
    expect(buildVendorScorecard([], "2026-06-01")).toEqual([]);
  });
});
