// Regression tests for the Inspector dashboard's dynamic priority routing (see
// priority-routing.ts's doc comment): the "My pending actions" worklist used to be truncated to the
// most recently created 8 items, regardless of urgency, so an old high-priority item could be pushed
// off the list by newer low-priority ones. sortByDynamicPriority is the pure fix, tested here without
// a live Supabase/Next.js request context.
import { describe, expect, it } from "vitest";
import { sortByDynamicPriority, type PriorityRoutable } from "../priority-routing";

function item(id: string, priority: PriorityRoutable["priority"], ageDays: number) {
  return { id, priority, ageDays };
}

describe("sortByDynamicPriority", () => {
  it("puts high priority before medium before low, regardless of input order", () => {
    const items = [item("low", "low", 1), item("high", "high", 1), item("medium", "medium", 1)];
    expect(sortByDynamicPriority(items).map((i) => i.id)).toEqual(["high", "medium", "low"]);
  });

  it("the exact regression this closes: an old high-priority item outranks newer low-priority ones", () => {
    const items = [
      item("new-low-1", "low", 0),
      item("new-low-2", "low", 0),
      item("old-high", "high", 10),
    ];
    const sorted = sortByDynamicPriority(items);
    expect(sorted[0].id).toBe("old-high");
  });

  it("breaks ties within the same priority tier by age, oldest/most-overdue first", () => {
    const items = [item("newer", "high", 1), item("older", "high", 5)];
    expect(sortByDynamicPriority(items).map((i) => i.id)).toEqual(["older", "newer"]);
  });

  it("does not mutate the input array", () => {
    const items = [item("low", "low", 1), item("high", "high", 1)];
    const original = [...items];
    sortByDynamicPriority(items);
    expect(items).toEqual(original);
  });
});
