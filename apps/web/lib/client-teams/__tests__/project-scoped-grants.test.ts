import { describe, expect, it } from "vitest";
import { grantClientTeamMemberProjectAccess } from "../helpers";

type Insert = Record<string, unknown>;

function fakeClient(failFor: Record<string, { code: string; message: string }> = {}) {
  const inserted: Insert[] = [];
  const client = {
    from: (table: string) => ({
      insert: async (row: Insert) => {
        if (table !== "access_grants") throw new Error(`unexpected table ${table}`);
        const failure = failFor[String(row.project_id)];
        if (failure) return { error: failure };
        inserted.push(row);
        return { error: null };
      },
    }),
  };
  return { client: client as never, inserted };
}

describe("grantClientTeamMemberProjectAccess (B7)", () => {
  it("inserts only project-scoped grants, one per assigned project, never an organisation-wide grant", async () => {
    const { client, inserted } = fakeClient();
    const res = await grantClientTeamMemberProjectAccess(client, { userId: "u", organizationId: "o", projectIds: ["p1", "p2"] });
    expect(res.error).toBeNull();
    expect(res.granted).toEqual(["p1", "p2"]);
    expect(inserted).toHaveLength(2);
    for (const row of inserted) {
      expect(row).toMatchObject({ user_id: "u", scope_type: "project", organization_id: "o", role: "member" });
      expect(row.project_id).toBeTruthy();
    }
  });

  it("grants nothing for a team with no assigned project", async () => {
    const { client, inserted } = fakeClient();
    const res = await grantClientTeamMemberProjectAccess(client, { userId: "u", organizationId: "o", projectIds: [] });
    expect(res).toEqual({ error: null, granted: [] });
    expect(inserted).toHaveLength(0);
  });

  it("ignores duplicates, still grants the rest and reports the first real failure", async () => {
    const { client, inserted } = fakeClient({ p1: { code: "23505", message: "dup" }, p2: { code: "P0001", message: "seat limit" } });
    const res = await grantClientTeamMemberProjectAccess(client, { userId: "u", organizationId: "o", projectIds: ["p1", "p2", "p3"] });
    expect(res.error?.message).toBe("seat limit");
    expect(res.granted).toEqual(["p3"]);
    expect(inserted.map((r) => r.project_id)).toEqual(["p3"]);
  });
});
