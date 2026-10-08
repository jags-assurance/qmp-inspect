import { describe, expect, it } from "vitest";
import { summariseWalkdown, walkdownSignOffError } from "../walkdown";

describe("walkdownSignOffError", () => {
  const ok = { isCreator: true, isAdmin: false, alreadySigned: false, itemCount: 3 };
  it("allows the creator or an admin", () => {
    expect(walkdownSignOffError(ok)).toBeNull();
    expect(walkdownSignOffError({ ...ok, isCreator: false, isAdmin: true })).toBeNull();
  });
  it("refuses others, repeats and empty walkdowns", () => {
    expect(walkdownSignOffError({ ...ok, isCreator: false })).toMatch(/Only the person/);
    expect(walkdownSignOffError({ ...ok, alreadySigned: true })).toMatch(/already/);
    expect(walkdownSignOffError({ ...ok, itemCount: 0 })).toMatch(/no items/);
  });
});

describe("summariseWalkdown", () => {
  it("counts live items by status and priority, ignoring withdrawn", () => {
    const s = summariseWalkdown([
      { status: "open", priority: "A" },
      { status: "resolved", priority: "B" },
      { status: "closed", priority: null },
      { status: "closed", priority: "A", withdrawn_at: "2026-01-01" },
    ]);
    expect(s).toEqual({ total: 3, open: 1, resolved: 1, closed: 1, byPriority: { A: 1, B: 2 } });
  });
});
