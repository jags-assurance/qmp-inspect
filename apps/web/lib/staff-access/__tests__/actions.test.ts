import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);

import { addStaffGrantAction, removeStaffGrantAction } from "../actions";

const grantForm = (over: Record<string, string> = {}) =>
  formData({ staff_user_id: "staff-2", scope_type: "organization", organization_id: "org-1", role: "Reviewer", ...over });

describe("addStaffGrantAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    mock.on("users", "select", { data: { id: "staff-2", is_jags_staff: true } });
    mock.on("access_grants", "insert", { data: { id: "grant-1" } });
  });

  it("refuses an inspector before touching the database", async () => {
    testCtx.session = sessions.inspector();
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toMatch(/Only a JAGS Admin/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an external party", async () => {
    testCtx.session = sessions.external();
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toMatch(/Only a JAGS Admin/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("treats a staff account with a null role as admin-equivalent", async () => {
    testCtx.session = sessions.admin({ staffRole: null });
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toBeNull();
    expect(mock.writes("access_grants", "insert")).toHaveLength(1);
  });

  it("rejects a target that is not JAGS staff and never inserts", async () => {
    mock.on("users", "select", { data: { id: "staff-2", is_jags_staff: false } });
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toMatch(/not a JAGS staff account/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("validates scope shape before any query", async () => {
    expect((await addStaffGrantAction({ error: null }, grantForm({ scope_type: "galaxy" }))).error).toMatch(/valid scope/);
    expect((await addStaffGrantAction({ error: null }, grantForm({ organization_id: "" }))).error).toMatch(/Choose an organisation/);
    expect((await addStaffGrantAction({ error: null }, grantForm({ scope_type: "project", project_id: "" }))).error).toMatch(/Choose a project/);
    expect(mock.calls).toHaveLength(0);
  });

  it("rejects a project that belongs to a different organisation", async () => {
    mock.on("projects", "select", { data: { organization_id: "org-other" } });
    const res = await addStaffGrantAction({ error: null }, grantForm({ scope_type: "project", project_id: "proj-1" }));
    expect(res.error).toMatch(/doesn't belong/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("inserts the grant and audits it for an admin", async () => {
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toBeNull();
    const [insert] = mock.writes("access_grants", "insert");
    expect(insert.payload).toMatchObject({ user_id: "staff-2", scope_type: "organization", organization_id: "org-1", project_id: null, role: "Reviewer" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "staff_access_grant", action: "granted" }));
  });

  it("stores a global grant with a null organisation", async () => {
    const res = await addStaffGrantAction({ error: null }, grantForm({ scope_type: "global", organization_id: "" }));
    expect(res.error).toBeNull();
    expect(mock.writes("access_grants", "insert")[0].payload).toMatchObject({ scope_type: "global", organization_id: null });
  });

  it("reports a duplicate grant", async () => {
    mock.on("access_grants", "insert", { error: { code: "23505", message: "dup" } });
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toMatch(/already has a grant/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("retries once with a single-use override when the seat limit blocks an admin who asked for it", async () => {
    mock.onOnce("access_grants", "insert", { error: { message: "Organisation seat limit reached" } });
    mock.on("seat_limit_overrides", "insert", { data: { id: "ovr-1" } });
    const res = await addStaffGrantAction({ error: null }, grantForm({ seat_override: "on", seat_override_reason: "Contractor surge" }));
    expect(res.error).toBeNull();
    expect(mock.writes("seat_limit_overrides", "insert")).toHaveLength(1);
    expect(mock.writes("access_grants", "insert")).toHaveLength(2);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "seat_limit_overridden" }));
  });

  it("does not override the seat limit without the explicit request", async () => {
    mock.on("access_grants", "insert", { error: { message: "Organisation seat limit reached" } });
    const res = await addStaffGrantAction({ error: null }, grantForm());
    expect(res.error).toMatch(/seat limit/i);
    expect(mock.writes("seat_limit_overrides")).toHaveLength(0);
  });

  it("refuses an override request that has no reason", async () => {
    const res = await addStaffGrantAction({ error: null }, grantForm({ seat_override: "on", seat_override_reason: "" }));
    expect(res.error).toMatch(/reason/);
    expect(mock.writes()).toHaveLength(0);
  });
});

describe("removeStaffGrantAction (last-admin guard)", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const globalGrant = { user_id: "other-user", organization_id: null, scope_type: "global", role: "Admin" };
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
  });
  const remove = () => removeStaffGrantAction({ error: null }, formData({ grant_id: "g-1" }));

  it("refuses a non-admin", async () => {
    testCtx.session = sessions.inspector();
    expect((await remove()).error).toMatch(/Only a JAGS Admin/);
    expect(mock.calls).toHaveLength(0);
  });

  it("blocks removing the only global grant held by an active admin", async () => {
    mock.on("access_grants", "select", (c) =>
      c.columns?.includes("users(") ? { data: [{ user_id: "insp", users: { is_jags_staff: true, staff_role: "inspector", is_active: true } }] } : { data: globalGrant }
    );
    const res = await remove();
    expect(res.error).toMatch(/only global grant held by an admin/);
    expect(mock.writes("access_grants", "delete")).toHaveLength(0);
  });

  it("ignores deactivated admins when counting the remaining global admins", async () => {
    mock.on("access_grants", "select", (c) =>
      c.columns?.includes("users(")
        ? { data: [{ user_id: "gone", users: { is_jags_staff: true, staff_role: "admin", is_active: false } }] }
        : { data: globalGrant }
    );
    expect((await remove()).error).toMatch(/only global grant/);
    expect(mock.writes("access_grants", "delete")).toHaveLength(0);
  });

  it("stops an admin removing their own global grant", async () => {
    mock.on("access_grants", "select", (c) =>
      c.columns?.includes("users(")
        ? { data: [{ user_id: "a2", users: { is_jags_staff: true, staff_role: "admin", is_active: true } }] }
        : { data: { ...globalGrant, user_id: "admin-1" } }
    );
    expect((await remove()).error).toMatch(/own global access/);
    expect(mock.writes("access_grants", "delete")).toHaveLength(0);
  });

  it("deletes and audits when another active admin remains", async () => {
    mock.on("access_grants", "select", (c) =>
      c.columns?.includes("users(")
        ? { data: [{ user_id: "a2", users: { is_jags_staff: true, staff_role: null, is_active: true } }] }
        : { data: globalGrant }
    );
    mock.on("access_grants", "delete", { data: [{ id: "g-1" }] });
    expect((await remove()).error).toBeNull();
    expect(mock.writes("access_grants", "delete")).toHaveLength(1);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "revoked" }));
  });

  it("lets an admin remove a scoped (non-global) grant without the guard query", async () => {
    mock.on("access_grants", "select", { data: { user_id: "x", organization_id: "org-1", scope_type: "organization", role: "R" } });
    mock.on("access_grants", "delete", { data: [{ id: "g-1" }] });
    expect((await remove()).error).toBeNull();
    expect(mock.calls.filter((c) => c.op === "select")).toHaveLength(1);
  });

  it("reports a refused delete (RLS removed no rows)", async () => {
    mock.on("access_grants", "select", { data: { user_id: "x", organization_id: "org-1", scope_type: "organization", role: "R" } });
    mock.on("access_grants", "delete", { data: [] });
    expect((await remove()).error).toMatch(/Could not remove/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});
