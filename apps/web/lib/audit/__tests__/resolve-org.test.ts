import { describe, expect, it } from "vitest";
import { resolveAuditOrganizationId } from "../log";

const client = (org: string | null) =>
  ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organization_id: org } }) }) }) }) }) as never;

describe("resolveAuditOrganizationId", () => {
  it("keeps an explicit organisation", async () => {
    expect(await resolveAuditOrganizationId(client("x"), "o1", "p1")).toBe("o1");
  });
  it("derives the organisation from the project when missing", async () => {
    expect(await resolveAuditOrganizationId(client("o2"), null, "p1")).toBe("o2");
  });
  it("stays null for platform-wide events (no project)", async () => {
    expect(await resolveAuditOrganizationId(client("o2"), null, null)).toBeNull();
  });
});
