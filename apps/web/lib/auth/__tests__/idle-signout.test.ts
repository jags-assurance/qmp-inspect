import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })), redirect: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    h.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }), signOut: h.signOut } }),
}));
vi.mock("@/lib/supabase/service", () => ({ isServiceRoleConfigured: () => false, createSupabaseServiceRoleClient: () => ({}) }));
vi.mock("@/lib/audit/log", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { idleSignOutAction, signOutAction } from "../actions";
import { IDLE_LOGIN_PATH, loginNotice } from "../login-notices";

describe("idle sign-out (A7)", () => {
  beforeEach(() => {
    h.signOut.mockClear();
    h.redirect.mockClear();
  });

  it("the idle path carries the same code the proxy uses, and that code has a message", () => {
    const code = new URL(IDLE_LOGIN_PATH, "http://x").searchParams.get("error") ?? undefined;
    expect(code).toBe("session_idle");
    expect(loginNotice(code)).toMatch(/signed out after a period of inactivity/i);
  });

  it("idleSignOutAction signs out and lands on /login with the inactivity notice", async () => {
    await expect(idleSignOutAction()).rejects.toThrow("NEXT_REDIRECT:/login?error=session_idle");
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it("a plain sign-out still goes to bare /login", async () => {
    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(h.redirect).toHaveBeenCalledWith("/login");
  });
});
