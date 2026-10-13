import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const notify = vi.hoisted(() => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => notify);

import { assignChecklistFixAction } from "../fix-assignment-actions";

const REC = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const TPL = "33333333-3333-4333-8333-333333333333";
const WHO = "44444444-4444-4444-8444-444444444444";
const fd = (over: Record<string, string> = {}) =>
  formData({ inspection_record_id: REC, checklist_item_id: ITEM, template_id: TPL, assignee_id: WHO, ...over });

describe("assignChecklistFixAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    notify.createNotification.mockClear();
    mock.on("inspection_records", "select", { data: { project_id: "proj-1", projects: { organization_id: "org-1" } } });
    mock.on("checklist_items", "select", { data: { item_number: "2.1", description: "Rebar cover" } });
    mock.on("notifications", "select", { data: [] });
  });

  it("rejects bad input before calling the database", async () => {
    expect((await assignChecklistFixAction({ error: null }, fd({ assignee_id: "not-a-uuid" }))).error).toMatch(/pick a person/i);
    expect((await assignChecklistFixAction({ error: null }, fd({ inspection_record_id: "" }))).error).toBeTruthy();
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("refuses when the database says the caller may not execute this activity", async () => {
    mock.onRpc("assign_checklist_item_fix", { error: { code: "42501" } });
    const res = await assignChecklistFixAction({ error: null }, fd());
    expect(res.error).toMatch(/inspector or the party/i);
    expect(notify.createNotification).not.toHaveBeenCalled();
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses an assignee without access to the project", async () => {
    mock.onRpc("assign_checklist_item_fix", { error: { code: "22023" } });
    const res = await assignChecklistFixAction({ error: null }, fd());
    expect(res.error).toMatch(/access to this project/i);
    expect(notify.createNotification).not.toHaveBeenCalled();
  });

  it("assigns, audits and notifies the assignee with a link to the checklist", async () => {
    mock.onRpc("assign_checklist_item_fix", { data: null });
    const res = await assignChecklistFixAction({ error: null }, fd());
    expect(res).toEqual({ error: null, saved: true });
    expect(mock.rpcCalls[0]).toEqual({
      name: "assign_checklist_item_fix",
      args: { p_inspection_record_id: REC, p_checklist_item_id: ITEM, p_user_id: WHO },
    });
    expect(notify.createNotification).toHaveBeenCalledTimes(1);
    expect((notify.createNotification.mock.calls as unknown as unknown[][])[0][1]).toMatchObject({ recipientUserId: WHO, link: `/inspect/checklists/${TPL}`, projectId: "proj-1" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "checklist_fix_assigned" }));
  });

  it("clears the assignment without notifying anyone", async () => {
    mock.onRpc("assign_checklist_item_fix", { data: null });
    const res = await assignChecklistFixAction({ error: null }, fd({ assignee_id: "" }));
    expect(res.error).toBeNull();
    expect(mock.rpcCalls[0].args).toMatchObject({ p_user_id: null });
    expect(notify.createNotification).not.toHaveBeenCalled();
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "checklist_fix_cleared" }));
  });
});
