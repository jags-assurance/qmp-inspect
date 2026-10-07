import { describe, it, expect } from "vitest";
import { TtlMemo } from "../readiness-memo";

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlMemo", () => {
  it("reuses a settled value until the TTL elapses, then reloads", async () => {
    const c = clock();
    const memo = new TtlMemo<number>(1000, 10, c.now);
    let loads = 0;
    const load = async () => ++loads;
    expect(await memo.get("a", load)).toBe(1);
    c.advance(999);
    expect(await memo.get("a", load)).toBe(1);
    c.advance(2);
    expect(await memo.get("a", load)).toBe(2);
    expect(loads).toBe(2);
  });

  it("shares one in-flight computation between concurrent callers", async () => {
    const memo = new TtlMemo<string>(1000);
    let loads = 0;
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const load = () => {
      loads += 1;
      return gate;
    };
    const p1 = memo.get("k", load);
    const p2 = memo.get("k", load);
    release("done");
    expect(await Promise.all([p1, p2])).toEqual(["done", "done"]);
    expect(loads).toBe(1);
  });

  it("never remembers a failure", async () => {
    const memo = new TtlMemo<number>(1000);
    let calls = 0;
    await expect(
      memo.get("k", async () => {
        calls += 1;
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    await Promise.resolve();
    expect(await memo.get("k", async () => 7)).toBe(7);
    expect(calls).toBe(1);
  });

  it("keeps keys independent and invalidates by prefix", async () => {
    const memo = new TtlMemo<string>(10_000);
    await memo.get("p1:u1", async () => "a");
    await memo.get("p1:u2", async () => "b");
    await memo.get("p2:u1", async () => "c");
    memo.invalidate("p1:");
    expect(memo.size).toBe(1);
    expect(await memo.get("p1:u1", async () => "fresh")).toBe("fresh");
    expect(await memo.get("p2:u1", async () => "new")).toBe("c");
  });

  it("evicts the oldest entries beyond maxEntries", async () => {
    const memo = new TtlMemo<number>(10_000, 2);
    await memo.get("a", async () => 1);
    await memo.get("b", async () => 2);
    await memo.get("c", async () => 3);
    expect(memo.size).toBe(2);
    expect(await memo.get("a", async () => 99)).toBe(99);
  });
});
