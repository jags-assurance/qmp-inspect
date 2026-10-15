import { describe, expect, it } from "vitest";
import { checkClientCode } from "../client-code-check";

const base = { otherOrgCodes: [], ownOtherTypeCodes: [], projectNumbers: [] as string[] };

describe("checkClientCode", () => {
  it("needs a code", () => {
    expect(checkClientCode({ ...base, code: " " }).status).toBe("conflict");
  });
  it("flags a code another organisation already uses and suggests this organisation's project numbers", () => {
    const r = checkClientCode({ ...base, code: "mer-2026-001", otherOrgCodes: ["MER-2026-001"], projectNumbers: ["THP-2026-001", "THP-2026-002"] });
    expect(r.status).toBe("conflict");
    expect(r.suggestions).toEqual(["THP-2026-001", "THP-2026-002"]);
  });
  it("does not suggest a code that is taken elsewhere", () => {
    const r = checkClientCode({ ...base, code: "X", otherOrgCodes: ["X", "THP-1"], projectNumbers: ["THP-1", "THP-2"] });
    expect(r.suggestions).toEqual(["THP-2"]);
  });
  it("warns when the code matches no project of the organisation", () => {
    expect(checkClientCode({ ...base, code: "ABC", projectNumbers: ["THP-2026-001"] }).status).toBe("warning");
  });
  it("warns when other doc types of the organisation use a different code", () => {
    const r = checkClientCode({ ...base, code: "THP-2026-001", projectNumbers: ["THP-2026-001"], ownOtherTypeCodes: [{ docType: "ncr", code: "OLD" }] });
    expect(r.status).toBe("warning");
    expect(r.message).toContain("ncr uses OLD");
  });
  it("is ok when free and matching a project", () => {
    expect(checkClientCode({ ...base, code: "thp-2026-001", projectNumbers: ["THP-2026-001"] }).status).toBe("ok");
  });
});
