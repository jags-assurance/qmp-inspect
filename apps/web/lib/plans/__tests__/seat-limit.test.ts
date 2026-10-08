import { describe, it, expect } from "vitest";
import { isSeatLimitError, parseSeatOverride, seatLimitMessage, summariseSeatUsage } from "../seat-limit";

function form(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("summariseSeatUsage", () => {
  it("is unchanged (unlimited) when no limit is set", () => {
    expect(summariseSeatUsage(40, null)).toEqual({ used: 40, limit: null, atLimit: false, overLimit: false, percent: null });
    expect(summariseSeatUsage(0, undefined).atLimit).toBe(false);
  });
  it("flags at and over the limit", () => {
    expect(summariseSeatUsage(3, 5)).toMatchObject({ atLimit: false, overLimit: false, percent: 60 });
    expect(summariseSeatUsage(5, 5)).toMatchObject({ atLimit: true, overLimit: false, percent: 100 });
    expect(summariseSeatUsage(7, 5)).toMatchObject({ atLimit: true, overLimit: true, percent: 100 });
  });
  it("handles a zero limit", () => {
    expect(summariseSeatUsage(0, 0)).toMatchObject({ atLimit: true, percent: 100 });
  });
});

describe("parseSeatOverride", () => {
  it("is not requested by default", () => {
    expect(parseSeatOverride(form({}))).toEqual({ requested: false, reason: "", error: null });
  });
  it("requires a reason when ticked", () => {
    expect(parseSeatOverride(form({ seat_override: "on", seat_override_reason: "  no " })).error).toMatch(/reason/);
    expect(parseSeatOverride(form({ seat_override: "on", seat_override_reason: "Client approved by phone" }))).toMatchObject({
      requested: true,
      reason: "Client approved by phone",
      error: null,
    });
  });
});

describe("seat limit messages", () => {
  it("recognises the trigger message", () => {
    expect(isSeatLimitError("This organisation has reached its seat limit (5)")).toBe(true);
    expect(isSeatLimitError("duplicate key")).toBe(false);
    expect(isSeatLimitError(null)).toBe(false);
  });
  it("only tells an Admin about the override", () => {
    expect(seatLimitMessage("x seat limit", true)).toMatch(/override/i);
    expect(seatLimitMessage("x seat limit", false)).not.toMatch(/tick/i);
  });
});
