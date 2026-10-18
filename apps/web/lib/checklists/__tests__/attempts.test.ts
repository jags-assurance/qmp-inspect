import { describe, expect, it } from "vitest";
import { attemptLabel, reinspectionState } from "../attempts";

describe("attemptLabel", () => {
  it("counts A, B, C and rolls over after Z", () => {
    expect(attemptLabel(0)).toBe("A");
    expect(attemptLabel(1)).toBe("B");
    expect(attemptLabel(25)).toBe("Z");
    expect(attemptLabel(26)).toBe("AA");
    expect(attemptLabel(27)).toBe("AB");
  });
  it("treats bad input as the first attempt", () => {
    expect(attemptLabel(-3)).toBe("A");
  });
});

describe("reinspectionState", () => {
  it("is Attempt A when nothing has run", () => {
    expect(reinspectionState([])).toEqual({ nextLabel: "A", isReinspection: false, failedLabel: null });
  });
  it("is a re-inspection after a fail", () => {
    expect(reinspectionState([{ revision: 0, result: "fail" }])).toEqual({ nextLabel: "B", isReinspection: true, failedLabel: "A" });
  });
  it("is not a re-inspection once the latest attempt passed", () => {
    const s = reinspectionState([{ revision: 1, result: "pass" }, { revision: 0, result: "fail" }]);
    expect(s).toEqual({ nextLabel: "C", isReinspection: false, failedLabel: null });
  });
  it("uses the newest attempt even when given oldest first", () => {
    expect(reinspectionState([{ revision: 0, result: "pass" }, { revision: 1, result: "fail" }]).failedLabel).toBe("B");
  });
});
