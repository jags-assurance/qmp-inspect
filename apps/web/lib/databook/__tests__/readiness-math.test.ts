import { describe, expect, it } from "vitest";
import { isCategoryComplete, strictPercentage } from "../readiness-math";

describe("strictPercentage", () => {
  it("is 100 for an empty category and when everything is ready", () => {
    expect(strictPercentage(0, 0)).toBe(100);
    expect(strictPercentage(200, 200)).toBe(100);
  });
  it("never rounds up to 100: 199 of 200 is 99", () => {
    expect(strictPercentage(199, 200)).toBe(99);
    expect(strictPercentage(999, 1000)).toBe(99);
    expect(isCategoryComplete({ ready: 199, total: 200 })).toBe(false);
  });
  it("floors other values", () => {
    expect(strictPercentage(1, 3)).toBe(33);
    expect(strictPercentage(2, 3)).toBe(66);
    expect(strictPercentage(0, 5)).toBe(0);
  });
  it("complete only when ready === total", () => {
    expect(isCategoryComplete({ ready: 5, total: 5 })).toBe(true);
    expect(isCategoryComplete({ ready: 0, total: 0 })).toBe(true);
  });
});
