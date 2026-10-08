import { describe, expect, it } from "vitest";
import { needsUnreadCountQuery, unreadInList } from "../unread";

describe("needsUnreadCountQuery", () => {
  it("is false when the list is shorter than the limit (it is the whole inbox)", () => {
    expect(needsUnreadCountQuery(new Array(19).fill({}), 20)).toBe(false);
    expect(needsUnreadCountQuery([], 20)).toBe(false);
  });
  it("is true when the list is full (more may exist)", () => {
    expect(needsUnreadCountQuery(new Array(20).fill({}), 20)).toBe(true);
  });
});

describe("unreadInList", () => {
  it("counts unread rows", () => {
    expect(unreadInList([{ is_read: false }, { is_read: true }, { is_read: false }])).toBe(2);
  });
});
