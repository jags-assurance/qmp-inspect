import { describe, expect, it } from "vitest";
import { describeItpExit } from "../exit-notice";

describe("describeItpExit", () => {
  it("shows status, date and reason for superseded and withdrawn ITPs", () => {
    expect(describeItpExit({ status: "superseded", reason: " Replaced by new scope ", at: "2026-10-01T10:00:00Z" })).toEqual({
      heading: "Superseded — read-only since 01/10/2026",
      reason: "Replaced by new scope",
    });
    expect(describeItpExit({ status: "withdrawn", reason: null, at: null })).toEqual({ heading: "Withdrawn — read-only", reason: "No reason recorded." });
  });
  it("returns null for live statuses", () => {
    expect(describeItpExit({ status: "approved", reason: "x", at: null })).toBeNull();
  });
});
