import { describe, expect, it } from "vitest";
import { FAST_POLL_MS, MID_POLL_MS, SLOW_POLL_MS, makeDueGate, nextPollDelayMs } from "../src/pollBackoff";

describe("nextPollDelayMs", () => {
  it("stays fast right after work, then slows while idle", () => {
    expect(nextPollDelayMs(0)).toBe(FAST_POLL_MS);
    expect(nextPollDelayMs(9)).toBe(FAST_POLL_MS);
    expect(nextPollDelayMs(10)).toBe(MID_POLL_MS);
    expect(nextPollDelayMs(29)).toBe(MID_POLL_MS);
    expect(nextPollDelayMs(30)).toBe(SLOW_POLL_MS);
    expect(nextPollDelayMs(5000)).toBe(SLOW_POLL_MS);
  });
});

describe("makeDueGate", () => {
  it("is due the first time and then once per interval, independent per task", () => {
    let t = 1000;
    const due = makeDueGate(() => t);
    expect(due("a", 60_000)).toBe(true);
    expect(due("a", 60_000)).toBe(false);
    expect(due("b", 60_000)).toBe(true);
    t += 59_999;
    expect(due("a", 60_000)).toBe(false);
    t += 1;
    expect(due("a", 60_000)).toBe(true);
  });
});
