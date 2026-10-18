import { describe, expect, it } from "vitest";
import {
  attemptLetter,
  attemptLetterFor,
  buildAttemptFileBase,
  buildFilingPath,
  buildInspectionReportTitle,
  earlierFailedAttempts,
  parseFilingPath,
  selectFinalAndEarlierAttempts,
  UNASSIGNED_DISCIPLINE_LABEL,
} from "../attempts";
import { buildZipEntryDir } from "@/lib/vault/zip-helpers";

const rec = (id: string, t: string, r: "pass" | "fail" | "partial" | null) => ({ id, created_at: `2026-01-0${t}T00:00:00Z`, overall_result: r });

describe("attemptLetter", () => {
  it("counts A..Z then AA", () => {
    expect([0, 1, 2, 25, 26, 27, 51, 52].map(attemptLetter)).toEqual(["A", "B", "C", "Z", "AA", "AB", "AZ", "BA"]);
  });
  it("clamps garbage to A", () => {
    expect(attemptLetter(-3)).toBe("A");
    expect(attemptLetter(Number.NaN)).toBe("A");
  });
});

describe("attempt selection", () => {
  const rows = [rec("c", "3", "pass"), rec("a", "1", "fail"), rec("b", "2", "fail")];
  it("letters follow creation order regardless of input order", () => {
    expect(["a", "b", "c"].map((id) => attemptLetterFor(rows, id))).toEqual(["A", "B", "C"]);
  });
  it("final is the passing attempt, earlier are the failed ones oldest first", () => {
    const { final, earlier } = selectFinalAndEarlierAttempts(rows);
    expect(final?.id).toBe("c");
    expect(earlier.map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("with no pass the newest attempt is final and older failures are earlier", () => {
    const { final, earlier } = selectFinalAndEarlierAttempts([rec("a", "1", "fail"), rec("b", "2", "fail")]);
    expect(final?.id).toBe("b");
    expect(earlier.map((r) => r.id)).toEqual(["a"]);
  });
  it("a partial counts as passing; a later fail does not displace the latest pass", () => {
    const { final } = selectFinalAndEarlierAttempts([rec("a", "1", "partial"), rec("b", "2", "fail")]);
    expect(final?.id).toBe("a");
  });
  it("handles an empty list", () => {
    expect(selectFinalAndEarlierAttempts([])).toEqual({ final: null, earlier: [] });
  });
  it("earlierFailedAttempts only returns failures created before the passing record", () => {
    const all = [rec("a", "1", "fail"), rec("b", "2", "pass"), rec("c", "3", "fail")];
    expect(earlierFailedAttempts(all, "b").map((r) => r.id)).toEqual(["a"]);
    expect(earlierFailedAttempts(all, "missing")).toEqual([]);
  });
});

describe("naming", () => {
  it("builds the report title with attempt and result, keeping the record number", () => {
    expect(buildInspectionReportTitle({ recordNumber: "ITP-1-INSP-2", attempt: "B", result: "fail", activity: "Weld visual" })).toBe(
      "Inspection Report ITP-1-INSP-2 — Attempt B (Fail) — Weld visual"
    );
    expect(buildInspectionReportTitle({ recordNumber: "X", attempt: "A", result: "partial", activity: "a" })).toContain("Pass with comments");
  });
  it("builds a file base with the attempt letter", () => {
    expect(buildAttemptFileBase("ITP-1-INSP-2", "C")).toBe("ITP-1-INSP-2-attemptC");
  });
});

describe("filing path", () => {
  const ctx = { projectLabel: "P-1 · Plant", discipline: { code: "MEC", name: "Mechanical" }, itpNumber: "ITP-001", itemNumber: "3.2", activity: "Weld / visual" };
  it("is project > discipline > ITP > activity and never contains a stray separator", () => {
    expect(buildFilingPath(ctx)).toBe("P-1 · Plant / MEC - Mechanical / ITP-001 / 3.2 Weld - visual");
  });
  it("is deterministic and round-trips", () => {
    expect(buildFilingPath(ctx)).toBe(buildFilingPath({ ...ctx }));
    expect(parseFilingPath(buildFilingPath(ctx))).toHaveLength(4);
  });
  it("falls back for an untagged discipline", () => {
    expect(parseFilingPath(buildFilingPath({ ...ctx, discipline: null }))[1]).toBe(UNASSIGNED_DISCIPLINE_LABEL);
  });
  it("zip dir drops the project segment and sanitises", () => {
    expect(buildZipEntryDir("Checklists & Forms", buildFilingPath(ctx))).toBe("Checklists & Forms/MEC - Mechanical/ITP-001/3.2 Weld - visual");
    expect(buildZipEntryDir("Certificates", null)).toBe("Certificates");
  });
});
