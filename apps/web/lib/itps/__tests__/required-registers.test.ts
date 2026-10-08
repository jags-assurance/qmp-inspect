import { describe, expect, it } from "vitest";
import { normaliseRequiredRegisters, parseRequiredRegisters, sameRegisters } from "../required-registers";

describe("parseRequiredRegisters", () => {
  it("keeps known kinds in a stable order and drops unknown ones", () => {
    expect(parseRequiredRegisters(["welder", "calibration", "bogus", "welder"])).toEqual(["calibration", "welder"]);
  });
  it("returns null when nothing is picked", () => {
    expect(parseRequiredRegisters([])).toBeNull();
    expect(parseRequiredRegisters(["nope"])).toBeNull();
  });
});

describe("normaliseRequiredRegisters / sameRegisters", () => {
  it("handles null, junk and order", () => {
    expect(normaliseRequiredRegisters(null)).toEqual([]);
    expect(normaliseRequiredRegisters("x")).toEqual([]);
    expect(normaliseRequiredRegisters(["personnel", "material"])).toEqual(["material", "personnel"]);
    expect(sameRegisters(["welder", "material"], ["material", "welder"])).toBe(true);
    expect(sameRegisters(null, [])).toBe(true);
    expect(sameRegisters(["welder"], null)).toBe(false);
  });
});
