import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const notify = vi.hoisted(() => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => notify);
// Collaborators of checklists/actions.ts that are not under test and pull in heavy SDKs / large graphs.
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
vi.mock("@/lib/punch-list/actions", () => ({ createPunchItemFromSource: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => ({ nextSequenceNumber: vi.fn(), generateDocumentNumber: vi.fn(), releaseSequence: vi.fn(async () => true), NumberingError: class NumberingError extends Error {} }));
vi.mock("@/lib/vault/irn-void", () => ({ supersedeIrnVaultDocuments: vi.fn() }));
vi.mock("@/lib/signoff/actions", () => ({ canCompleteInspection: vi.fn(async () => true) }));
vi.mock("../irn-notifications", () => ({ notifyAfterIrnIssued: vi.fn(), notifyAfterIrnVoided: vi.fn() }));
vi.mock("../inspection-notifications", () => ({ notifyInspectionStarted: vi.fn(), notifyInspectionPassed: vi.fn() }));
vi.mock("@/lib/registers/server-check", () => ({
  evaluateRegisterGate: vi.fn(async () => ({ error: null })),
  structuredResponseColumns: vi.fn(async () => ({})),
}));

import { bulkIssueIrnAction } from "../actions";
import { canCompleteInspection } from "@/lib/signoff/actions";

describe("bulkIssueIrnAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const rec = (id: string, over: Record<string, unknown> = {}) => ({ id, project_id: "proj-1", itp_number: "ITP-7", itp_item_id: "item-1", overall_result: "pass", ...over });
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    vi.mocked(canCompleteInspection).mockResolvedValue(true);
    mock.on("inspection_records", "select", (c) => {
      const id = c.filters.find((f) => f[0] === "eq" && f[1] === "id")?.[2] as string;
      return { data: id === "missing" ? null : id === "failed" ? rec(id, { overall_result: "fail" }) : rec(id) };
    });
    mock.on("ncrs", "select", { count: 0, data: null });
    mock.on("irns", "select", { data: null });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
    let n = 0;
    mock.onRpc("issue_irn", () => ({ data: [{ out_number: `ITP-7-IRN-${++n}`, out_already: false }] }));
  });

  it("rejects an empty or oversized selection before touching the database", async () => {
    expect((await bulkIssueIrnAction([])).error).toMatch(/at least one/);
    const many = Array.from({ length: 51 }, (_, i) => `r${i}`);
    expect((await bulkIssueIrnAction(many)).error).toMatch(/at most 50/);
    expect(mock.calls).toHaveLength(0);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("issues each record through the issue_irn RPC and continues past per-item failures", async () => {
    const res = await bulkIssueIrnAction(["a", "failed", "missing", "b", "a"]);
    expect(res.error).toBeNull();
    expect(res.items.map((i) => [i.id, i.status])).toEqual([["a", "issued"], ["failed", "skipped"], ["missing", "skipped"], ["b", "issued"]]);
    expect(res.items[0].irnNumber).toBe("ITP-7-IRN-1");
    expect(res.items[1].reason).toMatch(/passed/);
    expect(res.items[2].reason).toMatch(/not found/);
    expect(mock.rpcCalls.map((c) => c.args)).toEqual([{ p_inspection_record_id: "a" }, { p_inspection_record_id: "b" }]);
    expect(audit.recordAuditEvent).toHaveBeenCalledTimes(2);
  });

  it("applies the open-Hold gate per item", async () => {
    vi.mocked(canCompleteInspection).mockResolvedValueOnce(false);
    const res = await bulkIssueIrnAction(["a", "b"]);
    expect(res.items[0]).toMatchObject({ status: "skipped" });
    expect(res.items[0].reason).toMatch(/open Hold/);
    expect(res.items[1].status).toBe("issued");
  });

  it("applies the open-NCR gate", async () => {
    mock.on("ncrs", "select", { count: 2, data: null });
    const res = await bulkIssueIrnAction(["a"]);
    expect(res.items[0].reason).toMatch(/NCR/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("reports an existing live IRN as already issued without calling the RPC", async () => {
    mock.on("irns", "select", { data: { id: "irn-1" } });
    const res = await bulkIssueIrnAction(["a"]);
    expect(res.items[0].status).toBe("already");
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("surfaces the DB permission refusal (42501) per item", async () => {
    mock.onRpc("issue_irn", { error: { code: "42501", message: "denied" } });
    const res = await bulkIssueIrnAction(["a", "b"]);
    expect(res.items.every((i) => i.status === "skipped" && /not allowed/.test(i.reason ?? ""))).toBe(true);
  });

  it("refuses a party that is not assigned to execute the activity", async () => {
    testCtx.session = sessions.external();
    mock.on("activity_party_intervention", "select", { data: [] });
    const res = await bulkIssueIrnAction(["a"]);
    expect(res.items[0].reason).toMatch(/assigned to execute/);
    expect(mock.rpcCalls).toHaveLength(0);
  });
});
