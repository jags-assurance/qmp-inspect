import { describe, it, expect } from "vitest";
import { formatDocumentNumber } from "../format";

const base = { clientCode: "ACME", originatorCode: "JAGS", docType: "irn", seq: 7 };
const year = String(new Date().getFullYear());

describe("formatDocumentNumber", () => {
  it("pads the sequence and upper-cases doc type", () => {
    expect(formatDocumentNumber(base, { separator: "-", sequencePadding: 4, includeYear: false })).toBe("ACME-JAGS-IRN-0007");
  });
  it("does not truncate a sequence longer than padding", () => {
    expect(formatDocumentNumber({ ...base, seq: 12345 }, { separator: "-", sequencePadding: 3, includeYear: false })).toBe("ACME-JAGS-IRN-12345");
  });
  it("includes the current year when asked", () => {
    expect(formatDocumentNumber(base, { separator: "/", sequencePadding: 2, includeYear: true })).toBe(`ACME/JAGS/IRN/${year}/07`);
  });
  it("discipline goes after doc type, before year", () => {
    const r = formatDocumentNumber({ ...base, disciplineCode: "mech" }, { separator: "-", sequencePadding: 2, includeYear: true, includeDiscipline: true });
    expect(r).toBe(`ACME-JAGS-IRN-MECH-${year}-07`);
  });
  it("omits discipline when not resolvable or not enabled", () => {
    expect(formatDocumentNumber({ ...base, disciplineCode: null }, { separator: "-", sequencePadding: 2, includeYear: false, includeDiscipline: true })).toBe("ACME-JAGS-IRN-07");
    expect(formatDocumentNumber({ ...base, disciplineCode: "" }, { separator: "-", sequencePadding: 2, includeYear: false, includeDiscipline: true })).toBe("ACME-JAGS-IRN-07");
    expect(formatDocumentNumber({ ...base, disciplineCode: "ELEC" }, { separator: "-", sequencePadding: 2, includeYear: false })).toBe("ACME-JAGS-IRN-07");
  });
  it("drops empty client segment without blank separators", () => {
    expect(formatDocumentNumber({ ...base, clientCode: "" }, { separator: "-", sequencePadding: 2, includeYear: false })).toBe("JAGS-IRN-07");
  });
  it("supports empty separator", () => {
    expect(formatDocumentNumber(base, { separator: "", sequencePadding: 2, includeYear: false })).toBe("ACMEJAGSIRN07");
  });
});
