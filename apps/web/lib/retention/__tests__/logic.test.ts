import { describe, expect, it } from "vitest";
import { daysPastDue, parseRetentionReview, parseRetentionYears, reviewErrorMessage } from "../logic";

describe("parseRetentionYears", () => {
  it("accepts whole years from 1 to 100", () => {
    for (const ok of ["1", "7", " 10 ", "100"]) expect(parseRetentionYears(ok)).toEqual({ ok: true, years: Number(ok.trim()) });
  });

  it("rejects empty, decimal, negative, text and out-of-range values", () => {
    for (const bad of ["", "  ", "0", "101", "2.5", "-3", "seven", "1e2", null, undefined]) {
      expect(parseRetentionYears(bad).ok).toBe(false);
    }
  });
});

describe("parseRetentionReview", () => {
  it("lets a document be kept without a note", () => {
    expect(parseRetentionReview("keep", "")).toEqual({ ok: true, outcome: "keep", note: null });
    expect(parseRetentionReview("keep", " still needed for the warranty ")).toEqual({ ok: true, outcome: "keep", note: "still needed for the warranty" });
  });

  it("requires a real note to approve disposal", () => {
    expect(parseRetentionReview("dispose_approved", "").ok).toBe(false);
    expect(parseRetentionReview("dispose_approved", "ok").ok).toBe(false);
    expect(parseRetentionReview("dispose_approved", "Approved by QA manager, ref 123")).toEqual({
      ok: true,
      outcome: "dispose_approved",
      note: "Approved by QA manager, ref 123",
    });
  });

  it("rejects an unknown decision or an over-long note", () => {
    expect(parseRetentionReview("delete", "x").ok).toBe(false);
    expect(parseRetentionReview(null, null).ok).toBe(false);
    expect(parseRetentionReview("keep", "x".repeat(2001)).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("maps database errors", () => {
    expect(reviewErrorMessage("Only a JAGS Admin can review a retention flag")).toMatch(/Admin/);
    expect(reviewErrorMessage("This document is not flagged for retention review")).toMatch(/not flagged/);
    expect(reviewErrorMessage("A note is required when approving disposal")).toMatch(/note/);
    expect(reviewErrorMessage("boom")).toMatch(/Could not record/);
  });

  it("counts days past the due date, never negative", () => {
    const now = Date.parse("2026-11-12T10:00:00Z");
    expect(daysPastDue("2026-11-02", now)).toBe(10);
    expect(daysPastDue("2026-11-12", now)).toBe(0);
    expect(daysPastDue("2027-01-01", now)).toBe(0);
    expect(daysPastDue("garbage", now)).toBe(0);
  });
});
