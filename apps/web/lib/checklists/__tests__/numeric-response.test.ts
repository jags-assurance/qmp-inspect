import { describe, expect, it } from "vitest";
import { describeSpec, evaluateNumeric, parseNumericInput, specFromRow, validateSpecInput } from "../numeric-response";

describe("parseNumericInput", () => {
  it("accepts plain numbers and a decimal comma", () => {
    expect(parseNumericInput("12.5")).toBe(12.5);
    expect(parseNumericInput(" 12,5 ")).toBe(12.5);
    expect(parseNumericInput("-3")).toBe(-3);
    expect(parseNumericInput("1e3")).toBe(1000);
  });
  it("rejects blanks, text, infinity and huge values", () => {
    for (const bad of ["", "  ", "abc", "1.2.3", "Infinity", "NaN", "1e99", null, undefined]) {
      expect(parseNumericInput(bad as string)).toBeNull();
    }
  });
});

describe("evaluateNumeric", () => {
  it("is inclusive at both limits", () => {
    expect(evaluateNumeric(10, { min: 10, max: 12 })).toBe("yes");
    expect(evaluateNumeric(12, { min: 10, max: 12 })).toBe("yes");
    expect(evaluateNumeric(9.99, { min: 10, max: 12 })).toBe("no");
    expect(evaluateNumeric(12.01, { min: 10, max: 12 })).toBe("no");
  });
  it("handles one-sided limits", () => {
    expect(evaluateNumeric(100, { min: 5, max: null })).toBe("yes");
    expect(evaluateNumeric(4, { min: 5, max: null })).toBe("no");
    expect(evaluateNumeric(-1, { min: null, max: 0.5 })).toBe("yes");
    expect(evaluateNumeric(0.6, { min: null, max: 0.5 })).toBe("no");
  });
});

describe("describeSpec", () => {
  it("reads naturally", () => {
    expect(describeSpec({ min: 10, max: 12, unit: "mm" })).toBe("10 to 12 mm");
    expect(describeSpec({ min: 5, max: null, unit: "bar" })).toBe("at least 5 bar");
    expect(describeSpec({ min: null, max: 0.5, unit: null })).toBe("at most 0.5");
    expect(describeSpec({ min: 7, max: 7, unit: "m" })).toBe("7 m");
  });
});

describe("validateSpecInput", () => {
  it("needs at least one limit and an ordered range", () => {
    expect(validateSpecInput("", "", "mm")).toHaveProperty("error");
    expect(validateSpecInput("5", "2", "mm")).toHaveProperty("error");
    expect(validateSpecInput("a", "2", "mm")).toHaveProperty("error");
    expect(validateSpecInput("2", "5", " mm ")).toEqual({ spec: { min: 2, max: 5, unit: "mm" } });
    expect(validateSpecInput("", "5", "")).toEqual({ spec: { min: null, max: 5, unit: null } });
  });
});

describe("specFromRow", () => {
  it("returns null for pass/fail items and rebuilds numeric ones from string columns", () => {
    expect(specFromRow({ value_type: "pass_fail" })).toBeNull();
    expect(specFromRow(null)).toBeNull();
    expect(specFromRow({ value_type: "numeric", numeric_min: "10", numeric_max: "12.5", numeric_unit: "mm" })).toEqual({ min: 10, max: 12.5, unit: "mm" });
    expect(specFromRow({ value_type: "numeric", numeric_min: null, numeric_max: null })).toBeNull();
  });
});
