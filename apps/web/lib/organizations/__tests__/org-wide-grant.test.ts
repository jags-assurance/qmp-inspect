import { describe, expect, it } from "vitest";
import { holdsOrgWideGrant } from "../org-wide-grant";

const g = (scope_type: "global" | "organization" | "project", organization_id: string | null) => ({
  scope_type, organization_id, project_id: scope_type === "project" ? "p1" : null, role: "x",
});

describe("holdsOrgWideGrant", () => {
  it("accepts global and same-org organization grants", () => {
    expect(holdsOrgWideGrant({ grants: [g("global", null)] }, "org-1")).toBe(true);
    expect(holdsOrgWideGrant({ grants: [g("organization", "org-1")] }, "org-1")).toBe(true);
  });
  it("rejects project-scoped grants and other organisations", () => {
    expect(holdsOrgWideGrant({ grants: [g("project", "org-1")] }, "org-1")).toBe(false);
    expect(holdsOrgWideGrant({ grants: [g("organization", "org-2")] }, "org-1")).toBe(false);
    expect(holdsOrgWideGrant({ grants: [] }, "org-1")).toBe(false);
  });
});
