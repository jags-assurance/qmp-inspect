import { describe, expect, it } from "vitest";
import { groupHistoryByItem, type ResponseHistoryEntry } from "../response-history";

const e = (id: string, item: string, at: string): ResponseHistoryEntry => ({
  id,
  checklist_item_id: item,
  old_result: "yes",
  old_comment: null,
  old_numeric_value: null,
  changed_at: at,
  changed_by_name: null,
});

describe("groupHistoryByItem", () => {
  it("groups by item and keeps the incoming (newest first) order", () => {
    const out = groupHistoryByItem([e("1", "a", "3"), e("2", "b", "2"), e("3", "a", "1")]);
    expect(out.get("a")?.map((x) => x.id)).toEqual(["1", "3"]);
    expect(out.get("b")?.map((x) => x.id)).toEqual(["2"]);
    expect(out.size).toBe(2);
  });
});
