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
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn(), recordAiReviewDecision: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
vi.mock("@/lib/punch-list/actions", () => ({ createPunchItemFromSource: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => ({ generateDocumentNumber: vi.fn() }));
const supersede = vi.hoisted(() => ({ supersedeVaultDocumentsByReference: vi.fn(async () => undefined) }));
vi.mock("@/lib/vault/supersede-refs", () => supersede);

import { reopenNcrAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const reopened = {
  ncr_number: "NCR-001",
  project_id: "proj-1",
  assigned_to: "assignee-1",
  responsible_party_id: null,
  projects: { organization_id: "org-1" },
};

const form = (over: Record<string, string> = {}) => formData({ ncr_id: "ncr-1", reason: "Corrective action did not hold", ...over });
const reopen = (over: Record<string, string> = {}) => reopenNcrAction({ error: null }, form(over));

describe("reopenNcrAction", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "inspector-9" }));
    audit.recordAuditEvent.mockClear();
    supersede.supersedeVaultDocumentsByReference.mockClear();
    mock.on("ncrs", "select", (c) => (c.columns === "project_id" ? { data: { project_id: "proj-1" } } : { data: { reopen_count: 1 } }));
    mock.on("ncrs", "update", { data: reopened });
    mock.on("punch_list_items", "select", { data: [] });
    mock.onRpc("has_custom_permission", { data: false });
  });

  it("needs an NCR id and a reason of at least five characters before it reads anything", async () => {
    expect((await reopen({ ncr_id: "" })).error).toMatch(/Missing NCR/);
    expect((await reopen({ reason: "no" })).error).toMatch(/reason for re-opening/);
    expect(mock.calls).toHaveLength(0);
  });

  it("reports an NCR the caller cannot see and writes nothing", async () => {
    mock.on("ncrs", "select", { data: null });
    expect((await reopen()).error).toMatch(/not found, or you don't have access/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses an inspector who holds no close_ncr permission", async () => {
    const res = await reopen();
    expect(res.error).toMatch(/Only a JAGS admin, or someone granted the close NCR permission/);
    expect(mock.writes()).toHaveLength(0);
    expect(mock.rpcCalls[0]).toMatchObject({ name: "has_custom_permission", args: expect.objectContaining({ target_permission_key: "close_ncr", target_project_id: "proj-1" }) });
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("refuses an external user, even the raiser", async () => {
    testCtx.session = sessions.external({ userId: "raiser-1" });
    expect((await reopen()).error).toMatch(/close NCR permission/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets a close_ncr holder re-open: status returns to in_progress, only from closed, count incremented, audited", async () => {
    mock.onRpc("has_custom_permission", { data: true });
    const res = await reopen();
    expect(res.error).toBeNull();
    const [update] = mock.writes("ncrs", "update");
    expect(update.payload).toMatchObject({ status: "in_progress", closed_by: null, closed_at: null, last_reopen_reason: "Corrective action did not hold", reopen_count: 2 });
    expect(update.filters).toContainEqual(["eq", "status", "closed"]);
    expect(supersede.supersedeVaultDocumentsByReference).toHaveBeenCalledWith(expect.anything(), "proj-1", ["NCR-001", "NCR-001-closeout"]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "ncr", action: "reopened", actorId: "inspector-9" }));
  });

  it("lets an admin re-open without consulting custom permissions", async () => {
    testCtx.session = sessions.admin();
    expect((await reopen()).error).toBeNull();
    expect(mock.rpcCalls.filter((r) => r.name === "has_custom_permission")).toHaveLength(0);
    expect(mock.writes("ncrs", "update")).toHaveLength(1);
  });

  it("refuses an NCR that is not closed (the guarded update matches nothing) and touches nothing else", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "update", { data: null });
    expect((await reopen()).error).toMatch(/the NCR is not closed or you lack permission/);
    expect(mock.writeLog()).toEqual(["ncrs.update"]);
    expect(supersede.supersedeVaultDocumentsByReference).not.toHaveBeenCalled();
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("surfaces a database refusal (e.g. the guard on a withdrawn NCR) instead of pretending it re-opened", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "update", { error: { message: "A withdrawn NCR cannot be re-opened" } });
    const res = await reopen();
    expect(res.error).toBeTruthy();
    expect(supersede.supersedeVaultDocumentsByReference).not.toHaveBeenCalled();
    expect(mock.writes("punch_list_items")).toHaveLength(0);
  });

  it("re-opens the linked closed punch items and clears their closing stamps", async () => {
    testCtx.session = sessions.admin();
    mock.on("punch_list_items", "select", { data: [{ id: "pi-1", reopen_count: 0 }, { id: "pi-2", reopen_count: 3 }] });
    expect((await reopen()).error).toBeNull();
    const punch = mock.writes("punch_list_items", "update");
    expect(punch).toHaveLength(2);
    expect(punch[0].payload).toMatchObject({ status: "open", reopen_count: 1, closed_by: null, closed_at: null, resolved_by: null });
    expect(punch[1].payload).toMatchObject({ reopen_count: 4 });
    expect(punch[0].filters).toContainEqual(["eq", "status", "closed"]);
  });

  it("still re-opens the NCR but tells the user when a punch item could not be re-opened", async () => {
    testCtx.session = sessions.admin();
    mock.on("punch_list_items", "select", { data: [{ id: "pi-1", reopen_count: 0 }] });
    mock.on("punch_list_items", "update", { error: { message: "denied" } });
    const res = await reopen();
    expect(res.error).toMatch(/NCR re-opened, but 1 linked punch-list item/);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "reopened" }));
  });
});
