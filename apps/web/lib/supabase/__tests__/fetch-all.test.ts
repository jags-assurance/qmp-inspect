import { describe, expect, it } from "vitest";
import { chunkIds, fetchAll, fetchInChunksStrict } from "../fetch-all";

const pager = (total: number) => async (from: number, to: number) => ({
  data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i),
  error: null,
});

describe("fetchAll", () => {
  it("pages past the 1000-row cap", async () => {
    expect((await fetchAll<number>(pager(2500))).length).toBe(2500);
  });
  it("handles an exact multiple of the page size", async () => {
    expect((await fetchAll<number>(pager(2000))).length).toBe(2000);
  });
  it("returns [] for no rows", async () => {
    expect(await fetchAll<number>(pager(0))).toEqual([]);
  });
  it("throws on a query error instead of reading as empty", async () => {
    await expect(fetchAll<number>(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
  it("throws when the safety max is exceeded", async () => {
    await expect(fetchAll<number>(pager(5000), { max: 3000 })).rejects.toThrow("more than");
  });
});

describe("chunking", () => {
  it("splits ids", () => {
    expect(chunkIds([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("concatenates chunk results and throws on error", async () => {
    expect(await fetchInChunksStrict([1, 2, 3], async (c) => ({ data: c, error: null }), 2)).toEqual([1, 2, 3]);
    await expect(fetchInChunksStrict([1], async () => ({ data: null, error: { message: "x" } }))).rejects.toThrow("x");
  });
});
