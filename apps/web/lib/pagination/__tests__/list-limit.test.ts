import { describe, it, expect } from "vitest";
import { describeListWindow, hrefWithLimit, mergeNewestFirst, nextListLimit, parseListLimit } from "../list-limit";

const opts = { defaultLimit: 100, step: 100, max: 500 };

describe("parseListLimit", () => {
  it("falls back to the default for missing, junk or too-small values", () => {
    expect(parseListLimit(undefined, opts)).toBe(100);
    expect(parseListLimit("abc", opts)).toBe(100);
    expect(parseListLimit("-5", opts)).toBe(100);
    expect(parseListLimit("20", opts)).toBe(100);
    expect(parseListLimit("", opts)).toBe(100);
  });
  it("accepts a valid value, takes the first of an array, and clamps to max", () => {
    expect(parseListLimit("300", opts)).toBe(300);
    expect(parseListLimit(["200", "400"], opts)).toBe(200);
    expect(parseListLimit("999999", opts)).toBe(500);
  });
});

describe("nextListLimit", () => {
  it("steps up and stops at the ceiling", () => {
    expect(nextListLimit(100, opts)).toBe(200);
    expect(nextListLimit(450, opts)).toBe(500);
    expect(nextListLimit(500, opts)).toBeNull();
  });
});

describe("describeListWindow", () => {
  it("uses the over-fetch row when no exact total is known", () => {
    expect(describeListWindow({ limit: 100, fetched: 101, options: opts })).toMatchObject({ shown: 100, hasMore: true, next: 200, atCeiling: false });
    expect(describeListWindow({ limit: 100, fetched: 100, options: opts })).toMatchObject({ shown: 100, hasMore: false, next: null });
    expect(describeListWindow({ limit: 100, fetched: 12, options: opts })).toMatchObject({ shown: 12, hasMore: false });
  });
  it("uses an exact total when given", () => {
    expect(describeListWindow({ limit: 100, fetched: 100, total: 250, options: opts })).toMatchObject({ shown: 100, total: 250, hasMore: true, next: 200 });
    expect(describeListWindow({ limit: 300, fetched: 250, total: 250, options: opts })).toMatchObject({ hasMore: false, next: null });
  });
  it("flags the ceiling", () => {
    expect(describeListWindow({ limit: 500, fetched: 500, total: 900, options: opts })).toMatchObject({ hasMore: true, next: null, atCeiling: true });
  });
});

describe("mergeNewestFirst", () => {
  it("de-duplicates by id, keeps the first copy and orders newest first", () => {
    const a = { id: "a", created_at: "2026-01-02", tag: "primary" };
    const b = { id: "b", created_at: "2026-01-04", tag: "primary" };
    const aDup = { id: "a", created_at: "2026-01-02", tag: "extra" };
    const c = { id: "c", created_at: "2026-01-03", tag: "extra" };
    const merged = mergeNewestFirst([a, b], [aDup, c]);
    expect(merged.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(merged.find((r) => r.id === "a")?.tag).toBe("primary");
  });
  it("handles empty inputs", () => {
    expect(mergeNewestFirst([], [])).toEqual([]);
  });
});

describe("hrefWithLimit", () => {
  it("keeps other params, replaces limit, skips undefined", () => {
    expect(hrefWithLimit("/p", { tab: "punch-list", limit: "100", range: undefined }, 200)).toBe("/p?tab=punch-list&limit=200");
  });
  it("keeps repeated values", () => {
    expect(hrefWithLimit("/p", { a: ["1", "2"] }, 300)).toBe("/p?a=1&a=2&limit=300");
  });
});
