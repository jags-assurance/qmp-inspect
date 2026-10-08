import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("@/lib/supabase/service", () => ({ isServiceRoleConfigured: () => false, createSupabaseServiceRoleClient: () => ({}) }));
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);

import { bulkAccountLifecycleAction, deactivateUserAction, reactivateUserAction } from "../deactivation-actions";

const bulk = (emails: string, intent = "deactivate") => bulkAccountLifecycleAction({ error: null, results: [] }, formData({ emails, intent }));
const user = (over: Record<string, unknown> = {}) => ({ id: "u-2", email: "b@x.test", full_name: "B", is_active: true, ...over });

describe("deactivation actions", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    mock.on("users", "select", { data: user() });
  });

  it("refuses an inspector for bulk deactivation without any query", async () => {
    testCtx.session = sessions.inspector();
    const res = await bulk("b@x.test");
    expect(res.error).toMatch(/Only a JAGS Admin/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an external user for single deactivation and reactivation", async () => {
    testCtx.session = sessions.external();
    expect((await deactivateUserAction({ error: null, message: null }, formData({ user_id: "u-2" }))).error).toMatch(/Only a JAGS Admin/);
    expect((await reactivateUserAction({ error: null, message: null }, formData({ user_id: "u-2" }))).error).toMatch(/Only a JAGS Admin/);
    expect(mock.calls).toHaveLength(0);
  });

  it("deactivates each listed account, revoking grants and auditing", async () => {
    const res = await bulk("b@x.test");
    expect(res.error).toBeNull();
    expect(res.results).toEqual([{ email: "b@x.test", ok: true, detail: expect.stringContaining("was deactivated") }]);
    expect(mock.writes("users", "update")[0].payload).toEqual({ is_active: false });
    expect(mock.writes("access_grants", "delete")).toHaveLength(1);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "deactivated" }));
  });

  it("never deactivates the acting admin", async () => {
    mock.on("users", "select", { data: user({ id: "admin-1" }) });
    const res = await bulk("admin@jags.test");
    expect(res.results[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/own account/) });
    expect(mock.writes()).toHaveLength(0);
  });

  it("stops at the database last-admin guard and does not revoke grants", async () => {
    mock.on("users", "update", { error: { message: "cannot deactivate the last active JAGS Admin" } });
    const res = await bulk("b@x.test");
    expect(res.results[0].detail).toMatch(/last active JAGS Admin/);
    expect(mock.writes("access_grants")).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("skips unknown and already-deactivated addresses and flags invalid ones", async () => {
    mock.onOnce("users", "select", { data: null });
    mock.onOnce("users", "select", { data: user({ is_active: false }) });
    const res = await bulk("nobody@x.test, gone@x.test, not-an-email");
    expect(res.results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(res.results[0].detail).toMatch(/No matching account/);
    expect(res.results[1].detail).toMatch(/already deactivated/);
    expect(res.results[2].detail).toMatch(/valid email/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("rejects an empty list", async () => {
    expect((await bulk("   ")).error).toMatch(/at least one/);
  });

  it("reactivation by an admin reaches the users update", async () => {
    mock.on("users", "select", { data: user({ is_active: false }) });
    const res = await bulk("b@x.test", "reactivate");
    expect(res.results[0].ok).toBe(true);
    expect(mock.writes("users", "update")[0].payload).toEqual({ is_active: true });
  });
});
