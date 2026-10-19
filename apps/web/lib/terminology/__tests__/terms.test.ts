import { describe, expect, it } from "vitest";
import { applyTerms, parseOverrides, previewSentence, term, validateTermForms, validateTermLabel } from "../terms";

describe("term", () => {
  it("returns defaults", () => {
    expect(term("field_engineer")).toBe("Field Engineer");
    expect(term("field_engineer", null, { plural: true })).toBe("Field Engineers");
    expect(term("observation", {})).toBe("Observation");
    expect(term("ncr", {}, { plural: true })).toBe("NCRs");
  });
  it("returns overrides", () => {
    const o = { field_engineer: { singular: "Site Engineer", plural: "Site Engineers" } };
    expect(term("field_engineer", o)).toBe("Site Engineer");
    expect(term("field_engineer", o, { plural: true })).toBe("Site Engineers");
    expect(term("ncr", o)).toBe("NCR");
  });
});

describe("validation", () => {
  it("trims and bounds length", () => {
    expect(validateTermLabel("  Site   Engineer ")).toEqual({ ok: true, value: "Site Engineer" });
    expect(validateTermLabel("a").ok).toBe(false);
    expect(validateTermLabel("x".repeat(41)).ok).toBe(false);
    expect(validateTermLabel("x".repeat(40)).ok).toBe(true);
  });
  it("rejects angle brackets", () => {
    expect(validateTermLabel("<b>Hi</b>").ok).toBe(false);
  });
  it("defaults a blank plural and treats defaults as no override", () => {
    expect(validateTermForms("field_engineer", "Site Engineer", "")).toEqual({
      ok: true,
      forms: { singular: "Site Engineer", plural: "Site Engineers" },
    });
    expect(validateTermForms("field_engineer", "Field Engineer", "Field Engineers")).toEqual({ ok: true, forms: null });
    expect(validateTermForms("ncr", "N", "").ok).toBe(false);
  });
});

describe("parseOverrides", () => {
  it("ignores junk", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides([])).toEqual({});
    expect(parseOverrides({ bogus: { singular: "Hello" }, observation: { singular: "<x>" } })).toEqual({});
  });
  it("reads valid entries", () => {
    expect(parseOverrides({ observation: { singular: "Finding", plural: "Findings" } })).toEqual({
      observation: { singular: "Finding", plural: "Findings" },
    });
  });
});

describe("applyTerms", () => {
  const o = {
    field_engineer: { singular: "Site Engineer", plural: "Site Engineers" },
    observation: { singular: "Finding", plural: "Findings" },
  };
  it("is a no-op without overrides", () => {
    expect(applyTerms("Field Engineer Dashboard", null)).toBe("Field Engineer Dashboard");
    expect(applyTerms("Field Engineer Dashboard", {})).toBe("Field Engineer Dashboard");
  });
  it("replaces singular, plural and case", () => {
    expect(applyTerms("Field Engineer Dashboard", o)).toBe("Site Engineer Dashboard");
    expect(applyTerms("JAGS Field Engineers", o)).toBe("JAGS Site Engineers");
    expect(applyTerms("NCRs & Observations", o)).toBe("NCRs & Findings");
    expect(applyTerms("Raise an observation", o)).toBe("Raise an finding");
    expect(applyTerms("No observations raised yet.", o)).toBe("No findings raised yet.");
  });
  it("matches NCR case-sensitively", () => {
    const n = { ncr: { singular: "Non-conformance", plural: "Non-conformances" } };
    expect(applyTerms("NCRs & Observations", n)).toBe("Non-conformances & Observations");
    expect(applyTerms("Major NCR", n)).toBe("Major Non-conformance");
    expect(applyTerms("ncrs", n)).toBe("ncrs");
  });
  it("does not touch partial words", () => {
    expect(applyTerms("Observational", o)).toBe("Observational");
  });
});

describe("previewSentence", () => {
  it("fills the example", () => {
    expect(previewSentence("field_engineer", { singular: "Site Engineer", plural: "Site Engineers" })).toContain("Site Engineers sign off");
  });
});
