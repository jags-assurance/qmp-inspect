import { describe, expect, it } from "vitest";
import { buildAdminToday, buildExternalToday, buildInspectorToday } from "../today";

describe("buildInspectorToday", () => {
  const base = { overdueHoldPoints: 0, oldestHoldPointDays: 0, standaloneAssignments: [], pendingToday: [], pendingOverdue: [] };
  const action = (id: string, priority: "high" | "medium" | "low" = "low") => ({ templateId: id, checklistNumber: id, activity: "a", priority, projectName: "P", status: "not_started" as const });

  it("orders overdue first, then today/high priority, then routine", () => {
    const items = buildInspectorToday({ ...base, pendingActions: [action("r"), action("t"), action("o"), action("h", "high")], pendingToday: [{ templateId: "t" }], pendingOverdue: [{ templateId: "o" }] });
    expect(items.map((i) => [i.id, i.urgency])).toEqual([["o", 2], ["t", 1], ["h", 1], ["r", 0]]);
  });

  it("puts overdue hold points at the top", () => {
    const items = buildInspectorToday({ ...base, pendingActions: [action("o")], pendingOverdue: [{ templateId: "o" }], overdueHoldPoints: 3, oldestHoldPointDays: 17 });
    expect(items[0]).toMatchObject({ kind: "hold", title: "3 overdue hold points", urgency: 2 });
  });
});

describe("buildExternalToday", () => {
  const now = Date.parse("2026-10-02T00:00:00Z");
  it("treats notified sign-offs and past-due NCRs as urgent and routes acceptance to the panel", () => {
    const items = buildExternalToday({
      now,
      acceptance: [{ id: "i1", itpNumber: "ITP-1", title: "T", projectName: "P" }],
      review: [],
      signoffs: [{ id: "s1", activity: "a", itpId: "i2", itpNumber: "ITP-2", intervention: "H", status: "notified", when: null }, { id: "s2", activity: "b", itpId: "i2", itpNumber: "ITP-2", intervention: "W", status: "pending", when: null }],
      ncrs: [{ id: "n1", ncrNumber: "N-1", severity: "minor_ncr", description: "d", dueDate: "2026-09-01", projectName: "P" }, { id: "n2", ncrNumber: "N-2", severity: "observation", description: "d", dueDate: null, projectName: "P" }],
    });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.s1.urgency).toBe(2);
    expect(by.s2.urgency).toBe(1);
    expect(by.n1.urgency).toBe(2);
    expect(by.n2.urgency).toBe(0);
    expect(by.i1.panel).toBe("itp:i1");
    expect(items[0].urgency).toBe(2);
  });
});

describe("buildAdminToday", () => {
  it("major NCRs are urgent; proposals open the proposal panel", () => {
    const items = buildAdminToday({
      now: Date.parse("2026-10-02T00:00:00Z"),
      ncrs: [{ id: "a", ncrNumber: "N-A", severity: "minor_ncr", description: "d", projectLabel: "P", dueDate: null }, { id: "b", ncrNumber: "N-B", severity: "major_ncr", description: "d", projectLabel: "P", dueDate: null }],
      proposals: [{ id: "p", title: "New template" }],
    });
    expect(items[0].id).toBe("b");
    expect(items.find((i) => i.id === "p")?.panel).toBe("proposal:p");
  });
});
