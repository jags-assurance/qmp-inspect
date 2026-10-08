import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("@/lib/audit/log", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/rbac/permissions", () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock("@/lib/ncrs/recipients", () => ({ directoryClient: () => ({}), partyUserIds: async () => [] }));

import { addPunchItemAction, recordWalkdownAction } from "../actions";
import { defaultPunchDueDate, resolvePunchDueDate } from "../helpers";
import { siteToday } from "@/lib/ncrs/site-date";

describe("resolvePunchDueDate", () => {
  it("keeps a typed date and otherwise defaults from the priority", () => {
    expect(resolvePunchDueDate("2026-12-01", "A", "2026-10-07")).toBe("2026-12-01");
    expect(resolvePunchDueDate("", "A", "2026-10-07")).toBe("2026-10-14");
    expect(resolvePunchDueDate(undefined, "B", "2026-10-07")).toBe("2026-10-21");
    expect(resolvePunchDueDate("  ", "C", "2026-10-07")).toBe("2026-11-06");
  });
});

describe("punch item due date defaults from priority (J1)", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    mock.on("punch_list_items", "insert", { data: { id: "pi-1" } });
    mock.on("projects", "select", { data: [{ id: "proj-1", timezone: "UTC" }] });
  });
  const today = () => siteToday(new Date(), "UTC");

  it("addPunchItemAction fills the due date from priority A when none is typed", async () => {
    await addPunchItemAction({ error: null }, formData({ project_id: "proj-1", description: "Cracked tile", priority: "A" }));
    const payload = mock.writes("punch_list_items", "insert")[0].payload as Record<string, unknown>;
    expect(payload.due_date).toBe(defaultPunchDueDate("A", today()));
    expect(payload.priority).toBe("A");
  });

  it("addPunchItemAction keeps a typed due date", async () => {
    await addPunchItemAction({ error: null }, formData({ project_id: "proj-1", description: "Cracked tile", priority: "A", due_date: "2027-01-05" }));
    expect((mock.writes("punch_list_items", "insert")[0].payload as Record<string, unknown>).due_date).toBe("2027-01-05");
  });

  it("recordWalkdownAction defaults each row from its own priority", async () => {
    mock.on("punch_list_items", "insert", { data: [{ id: "a", responsible_party_id: null, description: "one" }, { id: "b", responsible_party_id: null, description: "two" }] });
    const fd = new FormData();
    fd.set("project_id", "proj-1");
    fd.append("description", "one");
    fd.append("description", "two");
    fd.append("priority", "A");
    fd.append("priority", "C");
    fd.append("due_date", "");
    fd.append("due_date", "2027-02-02");
    fd.append("location", "");
    fd.append("location", "");
    fd.append("responsible_party_id", "");
    fd.append("responsible_party_id", "");
    await recordWalkdownAction({ error: null }, fd);
    const rows = mock.writes("punch_list_items", "insert")[0].payload as Record<string, unknown>[];
    expect(rows[0].due_date).toBe(defaultPunchDueDate("A", today()));
    expect(rows[1].due_date).toBe("2027-02-02");
  });
});
