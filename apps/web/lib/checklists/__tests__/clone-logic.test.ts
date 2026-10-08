import { describe, expect, it } from "vitest";
import { selectCloneableResponses } from "../clone-logic";

const items = new Set(["a", "b", "c", "d", "e"]);
const none = new Set<string>();

describe("selectCloneableResponses", () => {
  it("copies only yes and na, never no", () => {
    const out = selectCloneableResponses(
      [
        { checklist_item_id: "a", result: "yes", comment: null },
        { checklist_item_id: "b", result: "no", comment: "bad" },
        { checklist_item_id: "c", result: "na", comment: "not applicable here" },
      ],
      items,
      none,
      none
    );
    expect(out.map((r) => r.checklist_item_id)).toEqual(["a", "c"]);
  });
  it("skips answered, measured and unknown items and duplicates", () => {
    const out = selectCloneableResponses(
      [
        { checklist_item_id: "a", result: "yes", comment: null },
        { checklist_item_id: "a", result: "yes", comment: "dup" },
        { checklist_item_id: "b", result: "yes", comment: null },
        { checklist_item_id: "c", result: "yes", comment: null },
        { checklist_item_id: "zzz", result: "yes", comment: null },
      ],
      items,
      new Set(["a"]),
      new Set(["b"])
    );
    expect(out.map((r) => r.checklist_item_id)).toEqual(["c"]);
  });
  it("normalises a blank comment to null", () => {
    expect(selectCloneableResponses([{ checklist_item_id: "a", result: "yes", comment: "  " }], items, none, none)[0].comment).toBeNull();
  });
});
