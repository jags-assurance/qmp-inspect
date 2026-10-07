import { describe, expect, it } from "vitest";
import {
  canChangeEvidence,
  canEditCapa,
  canEditNcrDetails,
  canWithdrawNcr,
  canWorkNcr,
  selfVerificationCheck,
} from "../rules";
import { parseNcrExtended, stripExtendedColumns } from "../extended";
import { formatDateOnly, siteToday } from "../site-date";
import { defaultPunchDueDate } from "@/lib/punch-list/helpers";
import { canWaiveEvidence, stripWaiverPrefix } from "@/lib/checklists/evidence-waiver";

describe("canWorkNcr with party team members", () => {
  const base = { isStaff: false, userId: "u", raisedBy: "r", assignedTo: "a", partyUserId: null };
  it("lets a party member work the NCR", () => {
    expect(canWorkNcr({ ...base, partyMemberIds: ["u"] })).toBe(true);
    expect(canWorkNcr({ ...base, partyMemberIds: ["x"] })).toBe(false);
  });
});

describe("CAPA / evidence lock", () => {
  it("lets close-authority holders edit while pending verification", () => {
    expect(canEditCapa("pending_verification", false, true)).toBe(true);
    expect(canEditCapa("pending_verification", false, false)).toBe(false);
    expect(canEditCapa("closed", true, true)).toBe(false);
    expect(canChangeEvidence("pending_verification", false, false)).toBe(false);
    expect(canChangeEvidence("in_progress", false, false)).toBe(true);
  });
  it("limits description edits and withdrawal", () => {
    expect(canEditNcrDetails("open", false, true)).toBe(true);
    expect(canEditNcrDetails("pending_verification", true, true)).toBe(false);
    expect(canWithdrawNcr("open", false, true)).toBe(true);
    expect(canWithdrawNcr("in_progress", false, true)).toBe(false);
    expect(canWithdrawNcr("in_progress", true, false)).toBe(true);
    expect(canWithdrawNcr("closed", true, true)).toBe(false);
  });
});

describe("selfVerificationCheck", () => {
  const input = { closerId: "c", isAdmin: false, assignedTo: null, capaUpdatedBy: null, overrideReason: "" };
  it("passes when the closer is independent", () => {
    expect(selfVerificationCheck(input)).toEqual({ ok: true, override: null });
  });
  it("blocks a non-admin assignee or CAPA author", () => {
    expect(selfVerificationCheck({ ...input, assignedTo: "c" }).ok).toBe(false);
    expect(selfVerificationCheck({ ...input, capaUpdatedBy: "c" }).ok).toBe(false);
  });
  it("lets an admin through only with a reason", () => {
    expect(selfVerificationCheck({ ...input, isAdmin: true, assignedTo: "c" }).ok).toBe(false);
    expect(selfVerificationCheck({ ...input, isAdmin: true, assignedTo: "c", overrideReason: "Sole qualified engineer on site" })).toEqual({
      ok: true,
      override: "Sole qualified engineer on site",
    });
  });
});

describe("parseNcrExtended", () => {
  const form = (o: Record<string, string>) => parseNcrExtended((n) => n in o, (n) => o[n]);
  it("returns only submitted fields", () => {
    expect(form({ location: " Bay 4 " }).values).toEqual({ location: "Bay 4" });
  });
  it("validates disposition, cost and schedule", () => {
    expect(form({ disposition: "scrap" }).error).toMatch(/Disposition/);
    expect(form({ cost_impact: "-5" }).error).toMatch(/Cost/);
    expect(form({ schedule_impact_days: "2.5" }).error).toMatch(/Schedule/);
    expect(form({ disposition: "rework", cost_impact: "1200.456", schedule_impact_days: "3" }).values).toEqual({
      disposition: "rework",
      cost_impact: 1200.46,
      schedule_impact_days: 3,
    });
  });
  it("strips extended columns for the pre-migration fallback", () => {
    expect(stripExtendedColumns({ status: "open", location: "x", disposition: "rework" })).toEqual({ status: "open" });
  });
});

describe("site dates", () => {
  it("uses the site calendar day", () => {
    expect(siteToday(new Date("2026-10-06T21:30:00Z"), "Asia/Dubai")).toBe("2026-10-07");
    expect(siteToday(new Date("2026-10-06T21:30:00Z"), "UTC")).toBe("2026-10-06");
    expect(formatDateOnly("2026-10-07")).toBe("07/10/2026");
  });
  it("derives punch due dates from priority", () => {
    expect(defaultPunchDueDate("A", "2026-10-07")).toBe("2026-10-14");
    expect(defaultPunchDueDate("B", "2026-10-07")).toBe("2026-10-21");
    expect(defaultPunchDueDate("C", "2026-10-07")).toBe("2026-11-06");
  });
});

describe("evidence waiver", () => {
  it("strips stale waiver lines so they are not duplicated on recompletion", () => {
    const stale = "[No evidence attached — reason: pure document review]\n[No evidence attached — reason: again]\nSite was dry.";
    expect(stripWaiverPrefix(stale)).toBe("Site was dry.");
    expect(stripWaiverPrefix("Plain note")).toBe("Plain note");
  });
  it("only staff may waive on a failed inspection", () => {
    expect(canWaiveEvidence({ isStaff: false, hasNoAnswers: true })).toBe(false);
    expect(canWaiveEvidence({ isStaff: true, hasNoAnswers: true })).toBe(true);
    expect(canWaiveEvidence({ isStaff: false, hasNoAnswers: false })).toBe(true);
  });
});
