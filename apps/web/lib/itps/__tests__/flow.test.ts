import { describe, expect, it } from "vitest";
import { buildActivityFlow, flowPosition, plainRole, type FlowCell, type FlowLevel } from "../flow";

const levels: FlowLevel[] = [
  { code: "H", label: "Hold", sort_order: 1, is_blocking: true },
  { code: "W", label: "Witness", sort_order: 2, is_blocking: false },
  { code: "R", label: "Review", sort_order: 3, is_blocking: false },
  { code: "S", label: "Surveillance", sort_order: 4, is_blocking: false },
];
const cell = (partyId: string, intervention: string | null, status: FlowCell["status"], isYou = false): FlowCell => ({
  partyId,
  partyName: partyId.toUpperCase(),
  intervention,
  status,
  isYou,
});

describe("buildActivityFlow", () => {
  it("orders the stages by the organisation's level order and skips parties with no role", () => {
    const stages = buildActivityFlow([cell("a", "S", "pending"), cell("b", "H", "notified"), cell("c", null, null)], levels, false);
    expect(stages.map((s) => s.code)).toEqual(["H", "S"]);
    expect(stages[0].steps).toHaveLength(1);
  });

  it("makes later levels wait for an open Hold (flexible mode) but not for non-blocking levels", () => {
    const stages = buildActivityFlow([cell("a", "H", "notified"), cell("b", "S", "notified"), cell("c", "R", "notified")], levels, false);
    const byCode = Object.fromEntries(stages.map((s) => [s.code, s]));
    expect(byCode.H.steps[0].state).toBe("now");
    // Review and Surveillance are non-blocking: in flexible mode they never wait.
    expect(byCode.R.steps[0].state).toBe("now");
    expect(byCode.S.steps[0].state).toBe("now");
  });

  it("makes a Hold wait for an earlier Hold, and everything wait in strict mode", () => {
    const two: FlowLevel[] = [
      { code: "H", label: "Hold", sort_order: 1, is_blocking: true },
      { code: "H2", label: "Final hold", sort_order: 2, is_blocking: true },
      ...levels.slice(1),
    ];
    const hold = buildActivityFlow([cell("a", "H", "notified"), cell("b", "H2", "notified")], two, false);
    expect(hold[1].steps[0]).toMatchObject({ state: "waiting", waitingFor: "Hold" });
    const strict = buildActivityFlow([cell("a", "H", "notified"), cell("b", "S", "notified")], levels, true);
    expect(strict[1].steps[0]).toMatchObject({ state: "waiting", waitingFor: "Hold" });
    expect(strict[1].state).toBe("waiting");
  });

  it("reports stage state: done, current, upcoming", () => {
    const stages = buildActivityFlow([cell("a", "H", "signed_off"), cell("b", "W", "notified"), cell("c", "S", "pending")], levels, false);
    expect(stages.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
  });

  it("treats proceeded-without-response as cleared for ordering but not as signed", () => {
    const stages = buildActivityFlow([cell("a", "W", "proceeded_no_response"), cell("b", "S", "notified")], levels, true);
    expect(stages[0].steps[0].state).toBe("proceeded");
    expect(stages[1].steps[0].state).toBe("now");
  });
});

describe("flowPosition", () => {
  it("tells the viewer where they are in plain words", () => {
    const stages = buildActivityFlow([cell("a", "H", "notified"), cell("me", "S", "notified", true)], levels, true);
    expect(flowPosition(stages)).toEqual({ index: 2, total: 2, text: "Waiting for Hold to be signed off first." });
    const mine = buildActivityFlow([cell("me", "H", "notified", true)], levels, false);
    expect(flowPosition(mine)).toEqual({ index: 1, total: 1, text: "It is your turn." });
    expect(flowPosition(buildActivityFlow([cell("a", "H", "notified")], levels, false))).toBeNull();
  });
});

describe("plainRole", () => {
  it("describes the built-in levels in site language", () => {
    expect(plainRole(levels[0])).toMatch(/approve before work/);
    expect(plainRole(levels[1])).toMatch(/present/);
    expect(plainRole({ code: "Q", label: "Regulatory review", is_blocking: false })).toBe("Regulatory review");
  });
});
