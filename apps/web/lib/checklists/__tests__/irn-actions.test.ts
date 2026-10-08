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
vi.mock("@/lib/punch-list/actions", () => ({ createPunchItemFromSource: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => ({ nextSequenceNumber: vi.fn(), generateDocumentNumber: vi.fn() }));
const supersede = vi.hoisted(() => ({ supersedeIrnVaultDocuments: vi.fn(async () => undefined) }));
vi.mock("@/lib/vault/irn-void", () => supersede);
const holds = vi.hoisted(() => ({ canCompleteInspection: vi.fn(async () => true) }));
vi.mock("@/lib/signoff/actions", () => holds);
const irnNotify = vi.hoisted(() => ({ notifyAfterIrnIssued: vi.fn(async () => undefined), notifyAfterIrnVoided: vi.fn(async () => undefined) }));
vi.mock("../irn-notifications", () => irnNotify);
vi.mock("../inspection-notifications", () => ({ notifyInspectionStarted: vi.fn(), notifyInspectionPassed: vi.fn() }));
vi.mock("@/lib/registers/server-check", () => ({
  evaluateRegisterGate: vi.fn(async () => ({ error: null })),
  structuredResponseColumns: vi.fn(async () => ({})),
}));

import { issueIrnAction, voidIrnAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const record = (over: Record<string, unknown> = {}) => ({
  id: "rec-1",
  project_id: "proj-1",
  itp_number: "ITP-001",
  itp_item_id: "item-1",
  overall_result: "pass",
  ...over,
});

describe("issueIrnAction", () => {
  let mock: Mock;
  const issue = () => issueIrnAction({ error: null }, formData({ inspection_record_id: "rec-1" }));

  /** What each guard in the action reads, set so the happy path passes; tests override one thing. */
  function seed(over: { record?: Record<string, unknown> | null } = {}) {
    mock.on("inspection_records", "select", (c) =>
      c.columns === "checklist_template_id" ? { data: { checklist_template_id: "tpl-1" } } : { data: over.record === undefined ? record() : over.record }
    );
    mock.on("ncrs", "select", { data: [], count: 0 });
    mock.on("irns", "select", { data: null });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
    mock.onRpc("issue_irn", { data: [{ out_id: "irn-1", out_number: "ITP-001-IRN-1", out_already: false }] });
  }

  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "inspector-1" }));
    audit.recordAuditEvent.mockClear();
    irnNotify.notifyAfterIrnIssued.mockClear();
    holds.canCompleteInspection.mockReset();
    holds.canCompleteInspection.mockResolvedValue(true);
    seed();
  });

  it("needs an inspection record id", async () => {
    const res = await issueIrnAction({ error: null }, formData({}));
    expect(res.error).toMatch(/Missing inspection record/);
    expect(mock.calls).toHaveLength(0);
  });

  it("reports an unknown inspection record and issues nothing", async () => {
    seed({ record: null });
    expect((await issue()).error).toMatch(/Inspection record not found/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("refuses a party that is not assigned to execute the activity, before any number is allocated", async () => {
    testCtx.session = sessions.external({ userId: "stranger" });
    mock.on("activity_party_intervention", "select", { data: [] });
    expect((await issue()).error).toMatch(/Only the party assigned to execute this activity \(or JAGS staff\)/);
    expect(mock.rpcCalls).toHaveLength(0);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets the assigned subcontractor issue the IRN", async () => {
    testCtx.session = sessions.external({ userId: "sub-1" });
    mock.on("activity_party_intervention", "select", { data: [{ project_parties: { id: "p-1", user_id: "sub-1", party_type: "subcontractor", is_active: true } }] });
    mock.on("itp_items", "select", { data: { itp_sections: { itps: { project_id: "proj-1" } } } });
    mock.on("projects", "select", (c) => (c.columns?.includes("allow_client_execution") ? { data: { allow_client_execution: false, organizations: null } } : { data: { organization_id: "org-1" } }));
    expect((await issue()).error).toBeNull();
    expect(mock.rpcCalls.map((r) => r.name)).toEqual(["issue_irn"]);
  });

  it.each([["fail"], [null], ["incomplete"]])("refuses to issue from an inspection whose result is %s", async (result) => {
    seed({ record: record({ overall_result: result }) });
    expect((await issue()).error).toMatch(/only be issued from a passed \(or conditionally passed\) inspection/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("refuses while the activity still has an open Hold", async () => {
    holds.canCompleteInspection.mockResolvedValue(false);
    expect((await issue()).error).toMatch(/open Hold/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("refuses a conditional pass that still has a mandatory item marked N/A", async () => {
    seed({ record: record({ overall_result: "partial" }) });
    mock.on("checklist_items", "select", { data: [{ id: "ci-1", item_number: "1", is_mandatory: true }] });
    mock.on("checklist_responses", "select", { data: [{ checklist_item_id: "ci-1", result: "na", comment: "n/a" }] });
    expect((await issue()).error).toMatch(/mandatory checklist item is marked N\/A/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("allows a conditional pass when the N/A items are not mandatory", async () => {
    seed({ record: record({ overall_result: "partial" }) });
    mock.on("checklist_items", "select", { data: [{ id: "ci-1", item_number: "1", is_mandatory: false }] });
    mock.on("checklist_responses", "select", { data: [{ checklist_item_id: "ci-1", result: "na", comment: "n/a" }] });
    expect((await issue()).error).toBeNull();
  });

  it("refuses while an NCR raised from this inspection is still open, and only counts real NCRs (never observations)", async () => {
    mock.on("ncrs", "select", { data: [], count: 1 });
    expect((await issue()).error).toMatch(/NCR raised from this inspection is still open/);
    const ncrQuery = mock.calls.find((c) => c.table === "ncrs");
    expect(ncrQuery?.filters).toContainEqual(["neq", "severity", "observation"]);
    expect(ncrQuery?.filters).toContainEqual(["neq", "status", "closed"]);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("is idempotent: a live IRN already exists, so nothing is allocated, audited or notified", async () => {
    mock.on("irns", "select", { data: { id: "irn-existing" } });
    expect((await issue()).error).toBeNull();
    const lookup = mock.calls.find((c) => c.table === "irns");
    expect(lookup?.filters).toContainEqual(["is", "voided_at", null]);
    expect(mock.rpcCalls).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
    expect(irnNotify.notifyAfterIrnIssued).not.toHaveBeenCalled();
  });

  it("will not allocate a number when the organisation cannot be resolved", async () => {
    mock.on("projects", "select", { data: null });
    expect((await issue()).error).toMatch(/Could not resolve the project's organisation/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("issues through the atomic issue_irn RPC, audits and notifies", async () => {
    expect((await issue()).error).toBeNull();
    expect(mock.rpcCalls).toEqual([{ name: "issue_irn", args: { p_inspection_record_id: "rec-1" } }]);
    expect(mock.writes("irns")).toHaveLength(0);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entityType: "irn", action: "issued", projectId: "proj-1", summary: "IRN ITP-001-IRN-1 issued" })
    );
    expect(irnNotify.notifyAfterIrnIssued).toHaveBeenCalledWith(expect.anything(), "rec-1", "ITP-001-IRN-1");
  });

  it("treats a concurrent winner as success without a second audit or notification", async () => {
    mock.onRpc("issue_irn", { data: [{ out_id: "irn-1", out_number: "ITP-001-IRN-1", out_already: true }] });
    expect((await issue()).error).toBeNull();
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
    expect(irnNotify.notifyAfterIrnIssued).not.toHaveBeenCalled();
  });

  it("maps a database permission refusal (42501) to a clear message and does not audit", async () => {
    mock.onRpc("issue_irn", { error: { code: "42501", message: "new row violates row-level security policy" } });
    expect((await issue()).error).toMatch(/not allowed to issue an IRN/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("does not fall back to the two-step path on an ordinary RPC failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mock.onRpc("issue_irn", { error: { code: "XX000", message: "boom" } });
    expect((await issue()).error).toBe("Could not issue the IRN.");
    expect(mock.rpcCalls.map((r) => r.name)).toEqual(["issue_irn"]);
    expect(mock.writes("irns")).toHaveLength(0);
  });

  describe("fallback when the issue_irn function is not deployed yet", () => {
    beforeEach(() => {
      mock.onRpc("issue_irn", { error: { code: "PGRST202", message: "Could not find the function public.issue_irn" } });
      mock.onRpc("next_document_sequence", { data: 7 });
    });

    it("allocates from the atomic counter, inserts the IRN with the issuer, audits and notifies", async () => {
      expect((await issue()).error).toBeNull();
      expect(mock.rpcCalls.map((r) => r.name)).toEqual(["issue_irn", "next_document_sequence"]);
      expect(mock.rpcCalls[1].args).toEqual({ org_id: "org-1", proj_id: "proj-1", seq_doc_type: "irn:ITP-001" });
      expect(mock.writes("irns", "insert")[0].payload).toEqual({ inspection_record_id: "rec-1", irn_number: "ITP-001-IRN-7", issued_by: "inspector-1" });
      expect(irnNotify.notifyAfterIrnIssued).toHaveBeenCalledWith(expect.anything(), "rec-1", "ITP-001-IRN-7");
    });

    it("fails closed when no number can be allocated (never invents one)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      mock.onRpc("next_document_sequence", { error: { message: "down" } });
      expect((await issue()).error).toMatch(/Could not allocate an IRN number/);
      expect(mock.writes("irns")).toHaveLength(0);
    });

    it("returns the winner when a concurrent insert hits the unique number (23505)", async () => {
      mock.on("irns", "insert", { error: { code: "23505", message: "duplicate key" } });
      mock.onOnce("irns", "select", { data: null });
      mock.onOnce("irns", "select", { data: { id: "irn-winner" } });
      expect((await issue()).error).toBeNull();
      expect(audit.recordAuditEvent).not.toHaveBeenCalled();
    });

    it("reports a refused insert (e.g. the write guard) as a failure", async () => {
      mock.on("irns", "insert", { error: { code: "42501", message: "An IRN can only be issued from a passed inspection" } });
      expect((await issue()).error).toBe("Could not issue the IRN.");
      expect(audit.recordAuditEvent).not.toHaveBeenCalled();
    });
  });
});

describe("voidIrnAction", () => {
  let mock: Mock;
  const REASON = "Issued against the wrong activity";
  const voidIrn = (over: Record<string, string> = {}) => voidIrnAction({ error: null }, formData({ irn_id: "irn-1", reason: REASON, ...over }));

  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    irnNotify.notifyAfterIrnVoided.mockClear();
    supersede.supersedeIrnVaultDocuments.mockClear();
    mock.on("irns", "select", { data: { id: "irn-1", irn_number: "ITP-001-IRN-1", inspection_record_id: "rec-1", voided_at: null } });
    mock.on("irns", "update", { data: [{ id: "irn-1" }] });
    mock.on("inspection_records", "select", { data: { project_id: "proj-1" } });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
  });

  it("needs an IRN and a reason of at least 15 characters before reading anything", async () => {
    expect((await voidIrn({ irn_id: "" })).error).toMatch(/Missing IRN/);
    expect((await voidIrn({ reason: "too short" })).error).toMatch(/at least 15 characters/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an external user", async () => {
    testCtx.session = sessions.external();
    expect((await voidIrn()).error).toMatch(/Only JAGS staff can void an IRN/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an inspector who is not a team lead on the project", async () => {
    testCtx.session = sessions.inspector();
    mock.on("team_project_assignments", "select", { data: [] });
    expect((await voidIrn()).error).toMatch(/Only an admin or a team lead on this project/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets an inspector who leads a team on the project void it", async () => {
    testCtx.session = sessions.inspector({ userId: "lead-1" });
    mock.on("team_project_assignments", "select", { data: [{ team_id: "team-1" }] });
    mock.on("team_members", "select", { data: [{ team_id: "team-1" }] });
    expect((await voidIrn()).error).toBeNull();
    expect(mock.writes("irns", "update")).toHaveLength(1);
  });

  it("reports an unknown IRN and one that is already void", async () => {
    mock.on("irns", "select", { data: null });
    expect((await voidIrn()).error).toMatch(/IRN not found/);
    mock.on("irns", "select", { data: { id: "irn-1", irn_number: "ITP-001-IRN-1", inspection_record_id: "rec-1", voided_at: "2026-01-01T00:00:00Z" } });
    expect((await voidIrn()).error).toMatch(/already void/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("voids as an admin: only from live, stamped with who and why, supersedes the filed PDF, queues the VOID copy, audits and notifies", async () => {
    expect((await voidIrn()).error).toBeNull();
    const [update] = mock.writes("irns", "update");
    expect(update.payload).toMatchObject({ voided_by: "admin-1", void_reason: REASON });
    expect(update.filters).toContainEqual(["is", "voided_at", null]);
    expect(supersede.supersedeIrnVaultDocuments).toHaveBeenCalledWith(expect.anything(), "proj-1", "ITP-001-IRN-1");
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "irn", action: "voided", actorId: "admin-1" }));
    expect(mock.writes("background_jobs", "insert")[0].payload).toMatchObject({ job_type: "render_irn_pdf", payload: { irn_id: "irn-1" } });
    expect(irnNotify.notifyAfterIrnVoided).toHaveBeenCalledWith(expect.anything(), "rec-1", "ITP-001-IRN-1", REASON);
  });

  it("reports a refused update (zero rows: voided meanwhile or blocked by the database) without audit or notification", async () => {
    mock.on("irns", "update", { data: [] });
    expect((await voidIrn()).error).toBe("Could not void the IRN.");
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
    expect(irnNotify.notifyAfterIrnVoided).not.toHaveBeenCalled();
    expect(mock.writes("background_jobs")).toHaveLength(0);
  });
});
