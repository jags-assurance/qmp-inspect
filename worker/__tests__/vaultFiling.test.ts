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
} from "../src/jobs/vaultFiling";

const rec = (id: string, t: string, r: "pass" | "fail" | "partial" | null) => ({ id, created_at: `2026-01-0${t}T00:00:00Z`, overall_result: r });

describe("worker vaultFiling (mirror of apps/web/lib/checklists/attempts.ts)", () => {
  it("attempt letters", () => {
    expect([0, 1, 25, 26, 52].map(attemptLetter)).toEqual(["A", "B", "Z", "AA", "BA"]);
  });
  it("selects the final passing attempt and lists earlier failures", () => {
    const rows = [rec("c", "3", "pass"), rec("a", "1", "fail"), rec("b", "2", "fail")];
    expect(["a", "b", "c"].map((id) => attemptLetterFor(rows, id))).toEqual(["A", "B", "C"]);
    const { final, earlier } = selectFinalAndEarlierAttempts(rows);
    expect(final?.id).toBe("c");
    expect(earlier.map((r) => r.id)).toEqual(["a", "b"]);
    expect(earlierFailedAttempts(rows, "c").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("newest attempt is final while nothing has passed", () => {
    expect(selectFinalAndEarlierAttempts([rec("a", "1", "fail"), rec("b", "2", null)]).final?.id).toBe("b");
  });
  it("naming and path", () => {
    expect(buildInspectionReportTitle({ recordNumber: "R-1", attempt: "B", result: "fail", activity: "Weld" })).toBe("Inspection Report R-1 — Attempt B (Fail) — Weld");
    expect(buildAttemptFileBase("R-1", "B")).toBe("R-1-attemptB");
    const p = buildFilingPath({ projectLabel: "P", discipline: null, itpNumber: "ITP-1", itemNumber: null, activity: "A/B" });
    expect(parseFilingPath(p)).toEqual(["P", UNASSIGNED_DISCIPLINE_LABEL, "ITP-1", "A-B"]);
  });
});
