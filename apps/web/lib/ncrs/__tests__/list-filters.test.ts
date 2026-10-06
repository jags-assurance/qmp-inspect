import { describe, it, expect } from "vitest";
import { applyNcrFilters, applyNcrSort, daysUntilDue } from "../list-filters";

// Records every chained call so filters can be asserted without Supabase.
function fakeQuery() {
  const calls: unknown[][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "is", "lt", "order"]) {
    q[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return q;
    };
  }
  return { q, calls };
}

describe("applyNcrFilters", () => {
  it("no params -> no filters", () => {
    const { q, calls } = fakeQuery();
    applyNcrFilters(q, {}, "u1");
    expect(calls).toEqual([]);
  });
  it("status=active excludes closed; valid status is eq; junk ignored", () => {
    let f = fakeQuery();
    applyNcrFilters(f.q, { status: "active" }, "u1");
    expect(f.calls).toEqual([["neq", "status", "closed"]]);
    f = fakeQuery();
    applyNcrFilters(f.q, { status: "in_progress" }, "u1");
    expect(f.calls).toEqual([["eq", "status", "in_progress"]]);
    f = fakeQuery();
    applyNcrFilters(f.q, { status: "x; drop table" }, "u1");
    expect(f.calls).toEqual([]);
  });
  it("severity only accepts major/minor", () => {
    let f = fakeQuery();
    applyNcrFilters(f.q, { severity: "major_ncr" }, "u1");
    expect(f.calls).toEqual([["eq", "severity", "major_ncr"]]);
    f = fakeQuery();
    applyNcrFilters(f.q, { severity: "observation" }, "u1");
    expect(f.calls).toEqual([]);
  });
  it("assignee me / unassigned and project", () => {
    let f = fakeQuery();
    applyNcrFilters(f.q, { assignee: "me", project: "p1" }, "u9");
    expect(f.calls).toEqual([
      ["eq", "project_id", "p1"],
      ["eq", "assigned_to", "u9"],
    ]);
    f = fakeQuery();
    applyNcrFilters(f.q, { assignee: "unassigned" }, "u9");
    expect(f.calls).toEqual([["is", "assigned_to", null]]);
  });
  it("overdue=1 excludes closed and compares due_date to today", () => {
    const f = fakeQuery();
    applyNcrFilters(f.q, { overdue: "1" }, "u1");
    expect(f.calls[0]).toEqual(["neq", "status", "closed"]);
    expect(f.calls[1][0]).toBe("lt");
    expect(f.calls[1][2]).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("applyNcrSort", () => {
  it("default is newest first", () => {
    const f = fakeQuery();
    applyNcrSort(f.q, undefined);
    expect(f.calls).toEqual([["order", "created_at", { ascending: false }]]);
  });
  it("due sorts soonest with nulls last, then newest", () => {
    const f = fakeQuery();
    applyNcrSort(f.q, "due");
    expect(f.calls[0]).toEqual(["order", "due_date", { ascending: true, nullsFirst: false }]);
    expect(f.calls).toHaveLength(2);
  });
  it("severity sort", () => {
    const f = fakeQuery();
    applyNcrSort(f.q, "severity");
    expect(f.calls[0]).toEqual(["order", "severity", { ascending: true }]);
  });
});

describe("daysUntilDue", () => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  it("null for closed or missing due date", () => {
    expect(daysUntilDue({ due_date: null, status: "open" })).toBeNull();
    expect(daysUntilDue({ due_date: day(3), status: "closed" })).toBeNull();
  });
  it("positive, zero, negative", () => {
    expect(daysUntilDue({ due_date: day(0), status: "open" })).toBe(0);
    expect(daysUntilDue({ due_date: day(5), status: "open" })).toBe(5);
    expect(daysUntilDue({ due_date: day(-2), status: "in_progress" })).toBe(-2);
  });
});
