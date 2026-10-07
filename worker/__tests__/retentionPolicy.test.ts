import { describe, expect, it } from "vitest";
import {
  RETENTION_SWEEP_INTERVAL_MS,
  addYearsUtc,
  isPastRetention,
  isValidRetentionYears,
  retentionCreatedCutoffIso,
  retentionDueOn,
  retentionReferenceDate,
  selectDocumentsToFlag,
  shouldRunRetentionSweep,
} from "../src/retentionPolicy";

const now = Date.parse("2026-11-12T10:00:00Z");

describe("retention dates (S6-18)", () => {
  it("starts the clock at approval, or at upload when never approved", () => {
    expect(retentionReferenceDate({ created_at: "2020-01-05T00:00:00Z", approved_at: "2020-02-01T00:00:00Z" })?.toISOString()).toBe("2020-02-01T00:00:00.000Z");
    expect(retentionReferenceDate({ created_at: "2020-01-05T00:00:00Z", approved_at: null })?.toISOString()).toBe("2020-01-05T00:00:00.000Z");
    expect(retentionReferenceDate({ created_at: "not a date" })).toBeNull();
  });

  it("adds calendar years in UTC and rolls 29 Feb back to 28 Feb", () => {
    expect(addYearsUtc(new Date("2020-03-15T10:00:00Z"), 7).toISOString().slice(0, 10)).toBe("2027-03-15");
    expect(addYearsUtc(new Date("2024-02-29T10:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(addYearsUtc(new Date("2024-02-29T10:00:00Z"), 4).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("is past retention on the due date itself, not the day before", () => {
    const ref = new Date("2019-11-12T23:00:00Z");
    expect(retentionDueOn(ref, 7)).toBe("2026-11-12");
    expect(isPastRetention(ref, 7, now)).toBe(true);
    expect(isPastRetention(new Date("2019-11-13T00:00:00Z"), 7, now)).toBe(false);
  });

  it("bounds the candidate query by creation time", () => {
    expect(retentionCreatedCutoffIso(now, 7)).toBe("2019-11-12T23:59:59.999Z");
  });

  it("only accepts whole years from 1 to 100", () => {
    for (const ok of [1, 7, 100]) expect(isValidRetentionYears(ok)).toBe(true);
    for (const bad of [0, -1, 101, 2.5, NaN, "7", null, undefined]) expect(isValidRetentionYears(bad)).toBe(false);
  });

  it("runs the sweep at most once every 24 hours", () => {
    expect(shouldRunRetentionSweep(null, now)).toBe(true);
    expect(shouldRunRetentionSweep(now - RETENTION_SWEEP_INTERVAL_MS + 1, now)).toBe(false);
    expect(shouldRunRetentionSweep(now - RETENTION_SWEEP_INTERVAL_MS, now)).toBe(true);
  });
});

describe("selectDocumentsToFlag", () => {
  const docs = [
    { id: "old", created_at: "2015-01-01T00:00:00Z", approved_at: "2015-01-10T00:00:00Z" },
    { id: "approved-recently", created_at: "2015-01-01T00:00:00Z", approved_at: "2024-01-01T00:00:00Z" },
    { id: "young", created_at: "2025-01-01T00:00:00Z", approved_at: null },
    { id: "never-approved-old", created_at: "2016-06-01T00:00:00Z", approved_at: null },
    { id: "bad-date", created_at: "oops", approved_at: null },
  ];

  it("flags only documents whose retention has run out and records the dates", () => {
    expect(selectDocumentsToFlag(docs, 7, now)).toEqual([
      { document_id: "old", retention_years: 7, reference_date: "2015-01-10", due_on: "2022-01-10" },
      { document_id: "never-approved-old", retention_years: 7, reference_date: "2016-06-01", due_on: "2023-06-01" },
    ]);
  });

  it("flags nothing for an invalid retention setting", () => {
    expect(selectDocumentsToFlag(docs, 0, now)).toEqual([]);
    expect(selectDocumentsToFlag(docs, 500, now)).toEqual([]);
  });

  it("never mutates its input and returns plain flag rows only (no delete instruction exists)", () => {
    const copy = JSON.parse(JSON.stringify(docs));
    const flags = selectDocumentsToFlag(docs, 7, now);
    expect(docs).toEqual(copy);
    for (const f of flags) expect(Object.keys(f).sort()).toEqual(["document_id", "due_on", "reference_date", "retention_years"]);
  });
});
