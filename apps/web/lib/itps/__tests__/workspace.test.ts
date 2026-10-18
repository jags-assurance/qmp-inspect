import { describe, expect, it } from "vitest";
import { checklistInspectionState, nextNeed, partyState, summariseActivity, summariseOutstanding, summariseSection, type WorkspaceCell } from "../workspace";

const cell = (over: Partial<WorkspaceCell> = {}): WorkspaceCell => ({ intervention: "W", status: "pending", isBlocking: false, canSignOff: false, ...over });

describe("partyState", () => {
  it("treats a party without a level as not required, never pending", () => {
    expect(partyState({ intervention: null, status: null })).toBe("not_required");
    expect(partyState({ intervention: null, status: "pending" })).toBe("not_required");
  });
  it("maps each tracked status", () => {
    expect(partyState({ intervention: "H", status: "signed_off" })).toBe("signed_off");
    expect(partyState({ intervention: "W", status: "proceeded_no_response" })).toBe("proceeded");
    expect(partyState({ intervention: "W", status: "notified" })).toBe("notified");
    expect(partyState({ intervention: "R", status: "pending" })).toBe("pending");
    expect(partyState({ intervention: "R", status: null })).toBe("pending");
  });
});

describe("summariseActivity", () => {
  it("has no sign-offs when no party has a level", () => {
    const s = summariseActivity([cell({ intervention: null, status: null }), cell({ intervention: null, status: null })]);
    expect(s).toMatchObject({ required: 0, done: 0, status: "no_signoffs", holdOpen: false });
  });
  it("is fully signed off only when every required point is signed off", () => {
    expect(summariseActivity([cell({ status: "signed_off" }), cell({ status: "signed_off" })]).status).toBe("signed_off");
    expect(summariseActivity([cell({ status: "signed_off" }), cell({ status: "pending" })]).status).toBe("in_progress");
  });
  it("does not count 'proceeded without response' as a sign-off", () => {
    const s = summariseActivity([cell({ status: "proceeded_no_response" }), cell({ status: "signed_off" })]);
    expect(s.done).toBe(1);
    expect(s.status).toBe("in_progress");
    expect(s.proceeded).toBe(1);
  });
  it("ignores parties with no role when counting", () => {
    const s = summariseActivity([cell({ status: "signed_off" }), cell({ intervention: null, status: null })]);
    expect(s).toMatchObject({ required: 1, done: 1, status: "signed_off" });
  });
  it("keeps a Hold open until it is signed off", () => {
    expect(summariseActivity([cell({ intervention: "H", isBlocking: true, status: "notified" })]).holdOpen).toBe(true);
    expect(summariseActivity([cell({ intervention: "H", isBlocking: true, status: "signed_off" })]).holdOpen).toBe(false);
  });
  it("counts the viewer's own signable points only when notified", () => {
    const s = summariseActivity([
      cell({ status: "notified", canSignOff: true }),
      cell({ status: "pending", canSignOff: true }),
      cell({ status: "notified", canSignOff: false }),
    ]);
    expect(s.yourSignoffs).toBe(1);
  });
  it("is not started when nothing has been notified or signed", () => {
    expect(summariseActivity([cell({ status: "pending" }), cell({ status: "pending" })]).status).toBe("not_started");
  });
});

describe("summariseSection", () => {
  it("counts activities and points separately", () => {
    const a = summariseActivity([cell({ status: "signed_off" }), cell({ status: "signed_off" })]);
    const b = summariseActivity([cell({ status: "signed_off" }), cell({ status: "notified" })]);
    const c = summariseActivity([cell({ intervention: null, status: null })]);
    expect(summariseSection([a, b, c])).toEqual({
      activities: 3,
      fullySignedOff: 1,
      withSignoffs: 2,
      requiredPoints: 4,
      donePoints: 3,
      outstandingPoints: 1,
    });
  });
});

describe("summariseOutstanding", () => {
  const item = (id: string, cells: WorkspaceCell[], extra: { evidenceMissing?: boolean; recordsOutstanding?: number } = {}) => ({
    itemId: id,
    itemNumber: id,
    activity: `Activity ${id}`,
    summary: summariseActivity(cells),
    evidenceMissing: extra.evidenceMissing ?? false,
    recordsOutstanding: extra.recordsOutstanding ?? 0,
  });
  it("adds up what needs attention and points at the activities", () => {
    const out = summariseOutstanding([
      item("1.1", [cell({ intervention: "H", isBlocking: true, status: "notified", canSignOff: true })]),
      item("1.2", [cell({ status: "pending" }), cell({ status: "pending" })]),
      item("1.3", [cell({ status: "signed_off" })], { evidenceMissing: true, recordsOutstanding: 2 }),
    ]);
    expect(out).toMatchObject({ toNotify: 2, awaitingParty: 1, yourSignoffs: 1, holdsOpen: 1, evidenceMissing: 1, recordsOutstanding: 2 });
    expect(out.jumpTargets.map((t) => [t.itemNumber, t.reason])).toEqual([
      ["1.1", "your_signoff"],
      ["1.2", "to_notify"],
      ["1.3", "evidence"],
    ]);
  });
  it("limits the jump targets", () => {
    const many = Array.from({ length: 10 }, (_, i) => item(`2.${i}`, [cell({ status: "pending" })]));
    expect(summariseOutstanding(many, 3).jumpTargets).toHaveLength(3);
  });
});

describe("checklistInspectionState", () => {
  it("reads the newest inspection record", () => {
    expect(checklistInspectionState(false, [])).toBe("not_generated");
    expect(checklistInspectionState(true, [])).toBe("not_started");
    expect(checklistInspectionState(true, [{ overall_result: null }])).toBe("in_progress");
    expect(checklistInspectionState(true, [{ overall_result: "pass" }, { overall_result: "fail" }])).toBe("pass");
    expect(checklistInspectionState(true, [{ overall_result: "fail" }, { overall_result: "pass" }])).toBe("fail");
    expect(checklistInspectionState(true, [{ overall_result: "partial" }])).toBe("partial");
  });
});

describe("nextNeed", () => {
  const s = (cells: WorkspaceCell[]) => summariseActivity(cells);
  it("says what is needed now, most urgent first", () => {
    expect(nextNeed(s([cell({ intervention: null, status: null })]), []).kind).toBe("none");
    expect(nextNeed(s([cell({ status: "signed_off" })]), []).kind).toBe("done");
    expect(nextNeed(s([cell({ status: "notified", canSignOff: true }), cell({ intervention: "H", isBlocking: true, status: "notified" })]), []).kind).toBe("your_signoff");
    expect(nextNeed(s([cell({ intervention: "H", isBlocking: true, status: "notified" })]), ["GFL"]).kind).toBe("hold");
    expect(nextNeed(s([cell({ status: "notified" })]), ["GFL", "Voltway"]).text).toBe("Waiting for GFL, Voltway.");
    expect(nextNeed(s([cell({ status: "pending" })]), []).kind).toBe("to_notify");
  });
});
