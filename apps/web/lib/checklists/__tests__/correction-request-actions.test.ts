import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const notify = vi.hoisted(() => ({ createNotification: vi.fn(async () => true) }));
vi.mock("@/lib/notifications/helpers", () => notify);
const exec = vi.hoisted(() => ({ canExecuteItpItem: vi.fn(async () => true) }));
vi.mock("../execution-parties", () => exec);
const teams = vi.hoisted(() => ({ isTeamLeadForProject: vi.fn(async () => false) }));
vi.mock("@/lib/teams/helpers", () => teams);
vi.mock("@/lib/ncrs/recipients", async () => ({
  directoryClient: (c: unknown) => c,
  staffVerifierIds: vi.fn(async () => ["admin-1", "admin-2"]),
}));
vi.mock("@/lib/ncrs/unowned", () => ({ projectTeamLeadIds: vi.fn(async () => ["lead-1"]) }));
const reopen = vi.hoisted(() => ({ reopenInspectionAction: vi.fn(async () => ({ error: null as string | null })) }));
vi.mock("../lifecycle-actions", () => reopen);
const signoff = vi.hoisted(() => ({ withdrawSignoffAction: vi.fn(async () => ({ error: null as string | null })) }));
vi.mock("@/lib/signoff/actions", () => signoff);

import { requestCorrectionAction, resolveCorrectionRequestAction } from "../correction-request-actions";
import { approvalReason, pickCorrectionRecipients, validateCorrectionReason } from "../correction-request-logic";

type Mock = ReturnType<typeof resetTestCtx>;

describe("correction request logic", () => {
  it("needs a reason of at least 10 characters", () => {
    expect(validateCorrectionReason("too short")).toMatch(/at least 10/);
    expect(validateCorrectionReason("Wrong item ticked")).toBeNull();
  });
  it("notifies leads and admins once, never the requester", () => {
    expect(pickCorrectionRecipients(["a", "b"], ["b", "c", "me"], "me")).toEqual(["a", "b", "c"]);
  });
  it("builds a reopen reason that clears the 15 character minimum", () => {
    expect(approvalReason(null, "short reas0").length).toBeGreaterThanOrEqual(15);
  });
});

describe("requestCorrectionAction", () => {
  let mock: Mock;
  const run = (fields: Record<string, string> = {}) =>
    requestCorrectionAction({ error: null }, formData({ inspection_record_id: "rec-1", reason: "Wrong result ticked on item 3", ...fields }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.external());
    audit.recordAuditEvent.mockClear();
    notify.createNotification.mockClear();
    exec.canExecuteItpItem.mockResolvedValue(true);
    mock.on("inspection_records", "select", { data: { id: "rec-1", project_id: "proj-1", record_number: "R-1", itp_item_id: "item-1", overall_result: "pass" } });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
    mock.on("inspection_correction_requests", "select", { data: [] });
    mock.on("inspection_correction_requests", "insert", { data: [{ id: "req-1" }] });
  });

  it("rejects a short reason before any write", async () => {
    expect((await run({ reason: "nope" })).error).toMatch(/at least 10/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses an inspection that is not completed", async () => {
    mock.on("inspection_records", "select", { data: { id: "rec-1", project_id: "proj-1", record_number: "R-1", itp_item_id: "item-1", overall_result: null } });
    expect((await run()).error).toMatch(/not completed/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses someone who cannot execute the activity", async () => {
    exec.canExecuteItpItem.mockResolvedValue(false);
    expect((await run()).error).toMatch(/can execute this activity/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("does not duplicate an open request", async () => {
    mock.on("inspection_correction_requests", "select", { data: [{ id: "old" }] });
    expect((await run()).error).toMatch(/already open/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("records the request, audits it and notifies leads and admins", async () => {
    expect(await run()).toEqual({ error: null, ok: true });
    expect(mock.writes("inspection_correction_requests", "insert")[0].payload).toMatchObject({ inspection_record_id: "rec-1", requested_by: "external-1", project_id: "proj-1" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "correction_requested", entityId: "rec-1" }));
    const recipients = notify.createNotification.mock.calls.map((c) => (c as unknown as [unknown, { recipientUserId: string; link: string }])[1]);
    expect(recipients.map((r) => r.recipientUserId).sort()).toEqual(["admin-1", "admin-2", "lead-1"]);
    expect(recipients[0].link).toBe("/inspect/inspections/rec-1");
  });
});

describe("resolveCorrectionRequestAction", () => {
  let mock: Mock;
  const open = { id: "req-1", inspection_record_id: "rec-1", signoff_progress_id: null, project_id: "proj-1", requested_by: "external-1", reason: "Wrong result ticked", status: "open" };
  const run = (fields: Record<string, string> = {}) => resolveCorrectionRequestAction({ error: null }, formData({ request_id: "req-1", decision: "approve", ...fields }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    notify.createNotification.mockClear();
    reopen.reopenInspectionAction.mockClear();
    reopen.reopenInspectionAction.mockResolvedValue({ error: null });
    teams.isTeamLeadForProject.mockResolvedValue(false);
    mock.on("inspection_correction_requests", "select", { data: open });
    mock.on("inspection_correction_requests", "update", { data: [{ id: "req-1" }] });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
    mock.on("users", "select", { data: { full_name: "Pat Party" } });
  });

  it("only an admin or team lead can resolve", async () => {
    resetTestCtx(sessions.inspector());
    mock = (await import("@/lib/test-utils/mock-supabase")).testCtx.mock;
    mock.on("inspection_correction_requests", "select", { data: open });
    expect((await run()).error).toMatch(/admin or a team lead/);
    expect(reopen.reopenInspectionAction).not.toHaveBeenCalled();
    expect(mock.writes()).toHaveLength(0);
  });

  it("approval runs the existing reopen path with the request's reason, then marks approved", async () => {
    expect(await run()).toEqual({ error: null, ok: true });
    const fd = reopen.reopenInspectionAction.mock.calls[0] as unknown as [unknown, FormData];
    expect(fd[1].get("inspection_record_id")).toBe("rec-1");
    expect(String(fd[1].get("reason"))).toContain("Wrong result ticked");
    expect(mock.writes("inspection_correction_requests", "update")[0].payload).toMatchObject({ status: "approved", resolved_by: "admin-1" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "correction_approved" }));
    expect(notify.createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserId: "external-1" }));
  });

  it("leaves the request open when the reopen path refuses", async () => {
    reopen.reopenInspectionAction.mockResolvedValue({ error: "An open draft already exists" });
    expect((await run()).error).toMatch(/open draft/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("decline needs a note, then notifies the requester without reopening", async () => {
    expect((await run({ decision: "decline" })).error).toMatch(/note/);
    expect(await run({ decision: "decline", note: "Result is correct as recorded" })).toEqual({ error: null, ok: true });
    expect(reopen.reopenInspectionAction).not.toHaveBeenCalled();
    expect(mock.writes("inspection_correction_requests", "update")[0].payload).toMatchObject({ status: "declined", resolution_note: "Result is correct as recorded" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "correction_declined" }));
    expect(notify.createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserId: "external-1", title: "Correction request declined" }));
  });

  it("refuses an already resolved request", async () => {
    mock.on("inspection_correction_requests", "select", { data: { ...open, status: "declined" } });
    expect((await run()).error).toMatch(/already resolved/);
  });
});
