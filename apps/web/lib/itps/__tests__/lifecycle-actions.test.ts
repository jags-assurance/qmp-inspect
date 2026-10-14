import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));

import { deleteDraftItpAction, withdrawItpAction } from "../lifecycle-actions";

const itpRow = (over: Record<string, unknown> = {}) => ({
  status: "approved",
  itp_number: "ITP-001",
  title: "T",
  project_id: "proj-1",
  projects: { organization_id: "org-1" },
  ...over,
});
const exit = (fields: Record<string, string>) => withdrawItpAction({ error: null }, formData({ itp_id: "itp-1", reason: "Raised in error", ...fields }));

describe("withdrawItpAction / supersede", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("itps", "select", (c) => (c.columns?.includes("itp_number, title") ? { data: itpRow() } : { data: { id: "itp-2", itp_number: "ITP-002", status: "approved" } }));
    mock.on("itps", "update", { data: [{ id: "itp-1" }] });
  });

  it("refuses a non-staff caller before any query", async () => {
    testCtx.session = sessions.external();
    const res = await exit({});
    expect(res.error).toMatch(/Only JAGS staff/);
    expect(mock.calls).toHaveLength(0);
  });

  it("validates the request (short reason, missing replacement) before authenticating the write", async () => {
    expect((await exit({ reason: "no" })).error).toMatch(/reason/);
    expect((await exit({ mode: "superseded" })).error).toMatch(/replaces/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("withdraws for staff, guarded on the status it read, and audits", async () => {
    const res = await exit({});
    expect(res.error).toBeNull();
    const [update] = mock.writes("itps", "update");
    expect(update.payload).toMatchObject({ status: "withdrawn", withdrawn_by: "inspector-1", superseded_by_itp_id: null });
    expect(update.filters).toContainEqual(["eq", "status", "approved"]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "itp", action: "withdrawn" }));
  });

  it("supersedes with a replacement on the same project", async () => {
    const res = await exit({ mode: "superseded", superseded_by_itp_id: "itp-2" });
    expect(res.error).toBeNull();
    expect(mock.writes("itps", "update")[0].payload).toMatchObject({ status: "superseded", superseded_by_itp_id: "itp-2" });
  });

  it("refuses a replacement that is not found on the project", async () => {
    mock.on("itps", "select", (c) => (c.columns?.includes("itp_number, title") ? { data: itpRow() } : { data: null }));
    const res = await exit({ mode: "superseded", superseded_by_itp_id: "itp-9" });
    expect(res.error).toMatch(/same project/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses a replacement that would create a loop (A -> B -> A)", async () => {
    mock.on("itps", "select", (c) =>
      c.columns?.includes("itp_number, title")
        ? { data: itpRow() }
        : c.columns === "superseded_by_itp_id"
          ? { data: { superseded_by_itp_id: "itp-1" } }
          : { data: { id: "itp-2", itp_number: "ITP-002", status: "approved" } }
    );
    const res = await exit({ mode: "superseded", superseded_by_itp_id: "itp-2" });
    expect(res.error).toMatch(/loop/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses a replacement that is itself superseded", async () => {
    mock.on("itps", "select", (c) => (c.columns?.includes("itp_number, title") ? { data: itpRow() } : { data: { id: "itp-2", itp_number: "ITP-002", status: "superseded" } }));
    const res = await exit({ mode: "superseded", superseded_by_itp_id: "itp-2" });
    expect(res.error).toMatch(/itself superseded/);
  });

  describe("open inspections / NCRs", () => {
    beforeEach(() => {
      mock.on("itp_sections", "select", { data: [{ id: "sec-1" }] });
      mock.on("itp_items", "select", { data: [{ id: "item-1" }] });
      mock.on("inspection_records", "select", { data: [], count: 2 });
      mock.on("ncrs", "select", { data: [], count: 1 });
    });
    it("refuses without confirmation and asks for it", async () => {
      const res = await exit({});
      expect(res.error).toMatch(/2 open \(draft\) inspections and 1 open NCR/);
      expect(res.needsConfirm).toBe(true);
      expect(mock.writes()).toHaveLength(0);
    });
    it("proceeds once the Admin confirms", async () => {
      const res = await exit({ confirm_open_work: "1" });
      expect(res.error).toBeNull();
      expect(mock.writes("itps", "update")).toHaveLength(1);
    });
  });

  it("will not exit an ITP that is already terminal", async () => {
    mock.on("itps", "select", { data: itpRow({ status: "withdrawn" }) });
    const res = await exit({});
    expect(res.error).toMatch(/already withdrawn/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("reports a lost race (no row updated) without auditing", async () => {
    mock.on("itps", "update", { data: [] });
    const res = await exit({});
    expect(res.error).toMatch(/may have changed/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("deleteDraftItpAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const draft = { status: "draft", revision: 0, reviewed_by: null, itp_number: "ITP-001", project_id: "proj-1", projects: { organization_id: "org-1" } };
  const del = () => deleteDraftItpAction({ error: null }, formData({ itp_id: "itp-1" }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("itps", "select", { data: draft });
    mock.on("itps", "delete", { data: [{ id: "itp-1" }] });
  });

  it("deletes a pristine draft, audits and redirects to the register", async () => {
    await expect(del()).rejects.toMatchObject({ url: "/inspect/itps" });
    expect(mock.writes("itps", "delete")).toHaveLength(1);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "draft_deleted" }));
  });

  it.each([
    ["issued", { status: "approved" }],
    ["already reviewed", { reviewed_by: "someone" }],
    ["revised", { revision: 2 }],
  ])("refuses a draft that is %s", async (_label, over) => {
    mock.on("itps", "select", { data: { ...draft, ...over } });
    const res = await del();
    expect(res.error).toMatch(/never submitted/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses when revision history exists", async () => {
    mock.on("itp_revisions", "select", { data: [], count: 3 });
    const res = await del();
    expect(res.error).toMatch(/revision history/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses when an activity already has inspection history", async () => {
    mock.on("itp_sections", "select", { data: [{ id: "sec-1" }] });
    mock.on("itp_items", "select", { data: [{ id: "item-1", item_number: "1.1" }] });
    mock.on("inspection_records", "select", { data: [], count: 1 });
    const res = await del();
    expect(res.error).toMatch(/already has history/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("surfaces a database refusal (RLS deleted no rows) for a caller without permission", async () => {
    testCtx.session = sessions.external();
    mock.on("itps", "delete", { data: [] });
    const res = await del();
    expect(res.error).toMatch(/may not have permission/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is sent to login and nothing is read", async () => {
    testCtx.session = null;
    await expect(del()).rejects.toBeInstanceOf(RedirectError);
    expect(mock.calls).toHaveLength(0);
  });
});
