import { describe, expect, it } from "vitest";
import { canDeleteOrganization, canDeleteProject, confirmationMatches } from "../delete-helpers";

describe("canDeleteProject", () => {
  it("allows Draft and Cancelled only", () => {
    expect(canDeleteProject("draft").ok).toBe(true);
    expect(canDeleteProject("cancelled").ok).toBe(true);
    for (const s of ["active", "on_hold", "completed", null, undefined, ""]) expect(canDeleteProject(s).ok).toBe(false);
  });
  it("says what to do", () => {
    const v = canDeleteProject("active");
    expect(!v.ok && v.reason).toMatch(/Cancelled first/);
    const c = canDeleteProject("completed");
    expect(!c.ok && c.reason).toMatch(/cannot be deleted/);
  });
});

describe("canDeleteOrganization", () => {
  it("needs zero projects", () => {
    expect(canDeleteOrganization(0).ok).toBe(true);
    const one = canDeleteOrganization(1);
    expect(!one.ok && one.reason).toMatch(/1 project\. Delete it first/);
    const many = canDeleteOrganization(3);
    expect(!many.ok && many.reason).toMatch(/3 projects\. Delete them first/);
  });
});

describe("confirmationMatches", () => {
  it("is exact apart from surrounding spaces", () => {
    expect(confirmationMatches(" THP-2026-001 ", "THP-2026-001")).toBe(true);
    expect(confirmationMatches("thp-2026-001", "THP-2026-001")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
  });
});
