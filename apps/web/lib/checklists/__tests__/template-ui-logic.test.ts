import { describe, expect, it } from "vitest";
import {
  ARCHIVED_ITEMS_MESSAGE,
  filterByArchive,
  itemEditBlockReason,
  parseArchiveFilter,
  parsePreviousResponses,
  reviewStatusLabel,
  staleSnapshotWarning,
  templateDeleteBlockReason,
} from "../template-ui-logic";
import { FROZEN_ITEMS_MESSAGE } from "../template-logic";

describe("itemEditBlockReason", () => {
  it("explains archived and frozen, archived first", () => {
    expect(itemEditBlockReason({ archived: true, responseCount: 3 })).toBe(ARCHIVED_ITEMS_MESSAGE);
    expect(itemEditBlockReason({ archived: false, responseCount: 3 })).toBe(FROZEN_ITEMS_MESSAGE);
    expect(itemEditBlockReason({ archived: false, responseCount: 0 })).toBeNull();
    expect(itemEditBlockReason({ archived: false, responseCount: null })).toBeNull();
  });
});

describe("templateDeleteBlockReason", () => {
  it("blocks when records exist", () => {
    expect(templateDeleteBlockReason(2)).toMatch(/Archive it instead/);
    expect(templateDeleteBlockReason(0)).toBeNull();
  });
});

describe("archive filter", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const archived = new Set(["b"]);
  it("parses the query param", () => {
    expect(parseArchiveFilter("archived")).toBe("archived");
    expect(parseArchiveFilter("1")).toBe("archived");
    expect(parseArchiveFilter(undefined)).toBe("active");
  });
  it("hides archived by default and shows only archived on request", () => {
    expect(filterByArchive(rows, archived, "active").map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterByArchive(rows, archived, "archived").map((r) => r.id)).toEqual(["b"]);
  });
});

describe("staleSnapshotWarning", () => {
  it("warns only when both versions are known and differ", () => {
    expect(staleSnapshotWarning(1, 3)).toMatch(/version 1.*version 3/);
    expect(staleSnapshotWarning(2, 2)).toBeNull();
    expect(staleSnapshotWarning(null, 2)).toBeNull();
  });
});

describe("reviewStatusLabel", () => {
  it("maps statuses", () => {
    expect(reviewStatusLabel("approved").tone).toBe("success");
    expect(reviewStatusLabel("rejected").tone).toBe("danger");
    expect(reviewStatusLabel(null).label).toBe("Not reviewed");
  });
});

describe("parsePreviousResponses", () => {
  it("tolerates null and malformed entries", () => {
    expect(parsePreviousResponses(null)).toEqual([]);
    expect(parsePreviousResponses([null, { result: "yes" }, { checklist_item_id: "i1", result: "no", comment: "bad", item_number: "1" }])).toEqual([
      { checklist_item_id: "i1", item_number: "1", description: null, result: "no", comment: "bad" },
    ]);
  });
});
