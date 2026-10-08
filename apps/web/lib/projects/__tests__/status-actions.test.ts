import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));

import { updateProjectStatusAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const statusForm = (over: Record<string, string> = {}) => formData({ project_id: "proj-1", status: "completed", ...over });
const setStatus = (over: Record<string, string> = {}) => updateProjectStatusAction({ error: null }, statusForm(over));

function seedProject(mock: Mock, status: string) {
  mock.on("projects", "select", { data: { organization_id: "org-1", status, responsible_person_id: "resp-1" } });
  mock.on("projects", "update", { data: { id: "proj-1" } });
  mock.onRpc("close_project", { data: null });
}

describe("updateProjectStatusAction - close project", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    seedProject(mock, "active");
  });

  it("refuses an inspector and an external user before reading anything", async () => {
    testCtx.session = sessions.inspector();
    expect((await setStatus()).error).toMatch(/Only a JAGS Admin can change a project's status/);
    testCtx.session = sessions.external();
    expect((await setStatus()).error).toMatch(/Only a JAGS Admin/);
    expect(mock.calls).toHaveLength(0);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("rejects a missing project or an unknown status", async () => {
    expect((await setStatus({ project_id: "" })).error).toMatch(/Missing project or invalid status/);
    expect((await setStatus({ status: "archived" })).error).toMatch(/Missing project or invalid status/);
    expect(mock.calls).toHaveLength(0);
  });

  it("reports a project the admin cannot see", async () => {
    mock.on("projects", "select", { data: null });
    expect((await setStatus()).error).toMatch(/Project not found/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("does nothing when the project already has that status", async () => {
    seedProject(mock, "completed");
    expect((await setStatus()).error).toBeNull();
    expect(mock.rpcCalls).toHaveLength(0);
    expect(mock.writes()).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("closes through the close_project RPC (never a direct status update) and audits", async () => {
    const res = await setStatus();
    expect(res.error).toBeNull();
    expect(mock.rpcCalls).toEqual([{ name: "close_project", args: { p_project_id: "proj-1", p_reason: null } }]);
    expect(mock.writes("projects")).toHaveLength(0);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: "project", action: "status_changed", actorId: "admin-1", changes: { from: "active", to: "completed", reason: null } })
    );
  });

  it("passes the override reason through when closing with open items", async () => {
    const res = await setStatus({ reason: "Client accepted the open punch items" });
    expect(res.error).toBeNull();
    expect(mock.rpcCalls[0].args).toEqual({ p_project_id: "proj-1", p_reason: "Client accepted the open punch items" });
  });

  it("refuses a one-character override reason before calling the RPC", async () => {
    expect((await setStatus({ reason: "x" })).error).toMatch(/at least 5 characters/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("asks for a reason when the database refuses because items are still open, and does not audit", async () => {
    mock.onRpc("close_project", { error: { message: "Project has open NCRs; a reason is required" } });
    expect((await setStatus()).error).toMatch(/still has open NCRs, punch items or draft inspections\. Enter a reason/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("gives a generic error for any other refusal (e.g. the caller lost admin rights)", async () => {
    mock.onRpc("close_project", { error: { message: "Only admin staff can close a project" } });
    expect((await setStatus()).error).toMatch(/Could not close the project/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("updateProjectStatusAction - other transitions and re-opening", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
  });

  it("puts a live project on hold with a plain guarded update and no reason", async () => {
    seedProject(mock, "active");
    expect((await setStatus({ status: "on_hold" })).error).toBeNull();
    expect(mock.writes("projects", "update")[0].payload).toEqual({ status: "on_hold" });
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("reports a refused status update (zero rows) rather than success", async () => {
    seedProject(mock, "active");
    mock.on("projects", "update", { data: null });
    expect((await setStatus({ status: "on_hold" })).error).toMatch(/Could not update the project's status/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("will not re-open a completed project without a written reason", async () => {
    seedProject(mock, "completed");
    expect((await setStatus({ status: "active" })).error).toMatch(/Give a reason \(at least 5 characters\) for re-opening a completed project/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("re-opens a closed project with a reason, audits it as re-opened and notes a handover that was already issued", async () => {
    seedProject(mock, "completed");
    mock.on("data_books", "select", { data: [{ id: "db-1", book_number: "DB-001" }] });
    const res = await setStatus({ status: "active", reason: "Snag found after handover" });
    expect(res.error).toBeNull();
    expect(mock.writes("projects", "update")[0].payload).toEqual({ status: "active" });
    const actions = audit.recordAuditEvent.mock.calls.map((c) => (c as unknown as [unknown, { action: string }])[1].action);
    expect(actions).toEqual(["reopened", "reopened_after_handover"]);
  });

  it("tells the client users on a re-opened project (never the admin who did it)", async () => {
    seedProject(mock, "cancelled");
    mock.on("access_grants", "select", {
      data: [
        { user_id: "client-1", role: "client", scope_type: "project", organization_id: null, project_id: "proj-1" },
        { user_id: "admin-1", role: "client", scope_type: "project", organization_id: null, project_id: "proj-1" },
      ],
    });
    expect((await setStatus({ status: "active", reason: "Cancelled in error" })).error).toBeNull();
    const [insert] = mock.writes("notifications", "insert");
    const recipients = (insert.payload as { recipient_user_id: string }[]).map((n) => n.recipient_user_id);
    expect(recipients).toContain("client-1");
    expect(recipients).toContain("resp-1");
    expect(recipients).not.toContain("admin-1");
  });
});
