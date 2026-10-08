import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);

import { acceptTermsAction } from "../actions";
import { loadNeedsTermsAcceptance } from "../load";
import { TERMS_VERSION } from "../constants";
import { needsTermsAcceptance } from "../logic";
import { createSupabaseServerClient } from "@/lib/supabase/server";

describe("needsTermsAcceptance", () => {
  it("asks when never accepted or accepted an older version", () => {
    expect(needsTermsAcceptance({ terms_accepted_at: null, terms_version: null }, "v2")).toBe(true);
    expect(needsTermsAcceptance({ terms_accepted_at: "2026-01-01T00:00:00Z", terms_version: "v1" }, "v2")).toBe(true);
  });
  it("does not ask when the current version was accepted, or there is no row", () => {
    expect(needsTermsAcceptance({ terms_accepted_at: "2026-01-01T00:00:00Z", terms_version: "v2" }, "v2")).toBe(false);
    expect(needsTermsAcceptance(null, "v2")).toBe(false);
  });
});

describe("acceptTermsAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.external());
    audit.recordAuditEvent.mockClear();
  });

  it("records the server's version against the caller's own row only, and audits it", async () => {
    const res = await acceptTermsAction({ error: null, accepted: false });
    expect(res).toEqual({ error: null, accepted: true });
    const [write] = mock.writes("users", "update");
    expect(write.payload).toMatchObject({ terms_version: TERMS_VERSION, terms_accepted_at: expect.any(String) });
    expect(write.filters).toContainEqual(["eq", "id", sessions.external().userId]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "terms_accepted" }));
  });

  it("reports a plain message and writes no audit event before the migration is applied", async () => {
    mock.on("users", "update", { error: { code: "42703", message: "column users.terms_accepted_at does not exist" } });
    const res = await acceptTermsAction({ error: null, accepted: false });
    expect(res.accepted).toBe(false);
    expect(res.error).toMatch(/20261128000100/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("reports a generic failure for any other error", async () => {
    mock.on("users", "update", { error: { code: "42501", message: "denied" } });
    const res = await acceptTermsAction({ error: null, accepted: false });
    expect(res).toMatchObject({ accepted: false, error: expect.stringMatching(/Could not record/) });
  });
});

describe("loadNeedsTermsAcceptance", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.external());
  });
  const load = async () => loadNeedsTermsAcceptance(await createSupabaseServerClient(), "u-1");

  it("is true for a user who has not accepted", async () => {
    mock.on("users", "select", { data: { terms_accepted_at: null, terms_version: null } });
    expect(await load()).toBe(true);
  });
  it("is false once the current version is accepted", async () => {
    mock.on("users", "select", { data: { terms_accepted_at: "2026-10-01T00:00:00Z", terms_version: TERMS_VERSION } });
    expect(await load()).toBe(false);
  });
  it("is false (the app keeps working) when the columns do not exist yet", async () => {
    mock.on("users", "select", { error: { code: "42703", message: "column users.terms_accepted_at does not exist" } });
    expect(await load()).toBe(false);
  });
});
