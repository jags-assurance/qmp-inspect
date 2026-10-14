import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => true) }));
const rbac = vi.hoisted(() => ({ hasPermission: vi.fn(async () => false) }));
vi.mock("@/lib/rbac/permissions", () => rbac);
vi.mock("@/lib/ncrs/recipients", () => ({ directoryClient: (c: unknown) => c, partyUserIds: vi.fn(async () => []) }));

import { closePunchItemAction } from "../actions";

describe("closePunchItemAction admin override", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const run = (fields: Record<string, string> = {}) =>
    closePunchItemAction({ error: null }, formData({ punch_item_id: "p-1", project_id: "proj-1", verification_notes: "Checked on site", ...fields }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    rbac.hasPermission.mockResolvedValue(false);
    mock.on("punch_list_items", "update", { data: [{ id: "p-1", created_by: "u-2", resolved_by: "admin-1", description: "d" }] });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
  });

  it("normal close still filters out the closer's own resolutions", async () => {
    await run();
    const update = mock.writes("punch_list_items", "update")[0];
    expect(update.filters).toContainEqual(["neq", "resolved_by", "admin-1"]);
    expect(update.payload).not.toHaveProperty("closed_override_reason");
  });

  it("override needs at least 10 characters", async () => {
    expect((await run({ override_reason: "short" })).error).toMatch(/at least 10/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("only a JAGS Admin may override", async () => {
    resetTestCtx(sessions.inspector());
    rbac.hasPermission.mockResolvedValue(true);
    const r = await run({ override_reason: "single verifier, admin override" });
    expect(r.error).toMatch(/Only a JAGS Admin/);
  });

  it("admin override drops the different-person filter, stores the reason and audits it", async () => {
    expect((await run({ override_reason: "single verifier, admin override" })).error).toBeNull();
    const update = mock.writes("punch_list_items", "update")[0];
    expect(update.payload).toMatchObject({ status: "closed", closed_override_reason: "single verifier, admin override" });
    expect(update.filters.some((f) => f[0] === "neq" && f[1] === "resolved_by")).toBe(false);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ summary: "Punch item closed by admin override", changes: expect.objectContaining({ closed_override_reason: "single verifier, admin override" }) })
    );
  });
});
