import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
vi.mock("@/lib/audit/log", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { upsertNumberingConfigAction } from "../actions";
import { updateOrgBrandColorsAction } from "@/lib/branding/actions";

describe("self-managed org settings need an org-wide grant", () => {
  beforeEach(() => {
    // sessions.external has only a PROJECT-scoped grant on org-1.
    const mock = resetTestCtx(sessions.external());
    mock.on("organizations", "select", { data: { engagement_scope: "self_managed" } });
  });

  it("blocks a project-scoped user from changing numbering", async () => {
    const r = await upsertNumberingConfigAction({ error: null }, formData({ organization_id: "org-1", doc_type: "irn", client_code: "ABC" }));
    expect(r.error).toMatch(/Only a JAGS Admin/);
  });

  it("blocks a project-scoped user from changing brand colors", async () => {
    const r = await updateOrgBrandColorsAction({ error: null }, formData({ organization_id: "org-1" }));
    expect(r.error).toMatch(/Only a JAGS Admin/);
  });

  it("lets an org-wide self-managed user past the membership check", async () => {
    const mock = resetTestCtx(sessions.external({ grants: [{ scope_type: "organization", organization_id: "org-1", project_id: null, role: "Client" }] }));
    mock.on("organizations", "select", { data: { engagement_scope: "self_managed" } });
    const r = await updateOrgBrandColorsAction({ error: null }, formData({ organization_id: "org-1", brand_primary_color: "zzz" }));
    // Passed the gate; fails later on colour validation instead.
    expect(r.error).toMatch(/6-digit hex/);
  });
});
