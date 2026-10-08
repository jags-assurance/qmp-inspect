import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const svc = vi.hoisted(() => ({ configured: false, updateUserById: vi.fn(async () => ({ error: null as { message: string } | null })) }));
vi.mock("@/lib/supabase/service", () => ({
  isServiceRoleConfigured: () => svc.configured,
  createSupabaseServiceRoleClient: () => ({ auth: { admin: { updateUserById: svc.updateUserById } } }),
}));

import { anonymiseUserAction } from "../actions";
import { anonymisedEmail } from "../anonymise";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const run = (fields: Record<string, string> = {}) =>
  anonymiseUserAction({ error: null, message: null }, formData({ user_id: USER_ID, reason: "erasure request 2026-10-08, identity verified", ...fields }));

describe("anonymiseUserAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    svc.configured = false;
    svc.updateUserById.mockClear();
    svc.updateUserById.mockResolvedValue({ error: null });
    mock.onRpc("anonymise_user", { data: { status: "anonymised", skipped: [] } });
  });

  it("refuses an inspector and an external user without any database call", async () => {
    testCtx.session = sessions.inspector();
    expect((await run()).error).toMatch(/Only a JAGS Admin/);
    testCtx.session = sessions.external();
    expect((await run()).error).toMatch(/Only a JAGS Admin/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("requires an account, a typed reason of at least 10 characters and not the caller's own account", async () => {
    expect((await run({ user_id: "nope" })).error).toMatch(/Choose an account/);
    expect((await run({ reason: "short" })).error).toMatch(/at least 10 characters/);
    expect((await run({ reason: "x".repeat(501) })).error).toMatch(/at most 500/);
    testCtx.session = sessions.admin({ userId: USER_ID });
    expect((await run()).error).toMatch(/own account/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("calls anonymise_user with the reason and reports success", async () => {
    const res = await run();
    expect(res.error).toBeNull();
    expect(res.message).toMatch(/anonymised and deactivated/);
    expect(mock.rpcCalls).toEqual([{ name: "anonymise_user", args: { p_user_id: USER_ID, p_reason: "erasure request 2026-10-08, identity verified" } }]);
    // No client-side writes: the function does everything, including the audit event.
    expect(mock.writes()).toHaveLength(0);
    // Without the service role the Auth record cannot be changed: the admin is told.
    expect(res.message).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("mirrors the anonymisation in Supabase Auth (placeholder email, permanent ban) when the service role is configured", async () => {
    svc.configured = true;
    const res = await run();
    expect(res.error).toBeNull();
    expect(svc.updateUserById).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ email: anonymisedEmail(USER_ID), email_confirm: true, ban_duration: "876000h", app_metadata: { deactivated: true, anonymised: true } })
    );
  });

  it("says so when the Auth update fails, but the database anonymisation already happened", async () => {
    svc.configured = true;
    svc.updateUserById.mockResolvedValue({ error: { message: "boom" } });
    const res = await run();
    expect(res.error).toBeNull();
    expect(res.message).toMatch(/Auth\) record could not be updated/);
  });

  it("is idempotent: an already anonymised account is reported and Auth is not touched again", async () => {
    svc.configured = true;
    mock.onRpc("anonymise_user", { data: { status: "already_anonymised" } });
    const res = await run();
    expect(res.message).toMatch(/already anonymised/);
    expect(svc.updateUserById).not.toHaveBeenCalled();
  });

  it("translates the last-admin refusal and a missing migration", async () => {
    mock.onRpc("anonymise_user", { error: { code: "P0001", message: "This is the last active JAGS Admin, so the account cannot be anonymised." } });
    expect((await run()).error).toMatch(/last active JAGS Admin/);
    expect(svc.updateUserById).not.toHaveBeenCalled();
    mock.onRpc("anonymise_user", { error: { code: "PGRST202", message: "Could not find the function" } });
    expect((await run()).error).toMatch(/20261129000100/);
  });
});
