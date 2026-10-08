import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));
// The AI / punch-list / numbering collaborators are not under test and pull in heavy SDKs.
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn(), recordAiReviewDecision: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
vi.mock("@/lib/punch-list/actions", () => ({ createPunchItemFromSource: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/lib/vault/supersede-refs", () => ({ supersedeVaultDocumentsByReference: vi.fn() }));

import { setNcrStatusAction, updateNcrAction, withdrawNcrAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const ncrRow = (over: Record<string, unknown> = {}) => ({
  status: "pending_verification",
  raised_by: "raiser-1",
  assigned_to: "assignee-1",
  due_date: null,
  responsible_party_id: null,
  project_id: "proj-1",
  ncr_number: "NCR-001",
  root_cause: "rc",
  corrective_action: "ca",
  preventive_action: "pa",
  projects: { organization_id: "org-1" },
  ...over,
});

const closeForm = (over: Record<string, string> = {}) =>
  formData({
    ncr_id: "ncr-1",
    close_now: "true",
    root_cause: "rc",
    corrective_action: "ca",
    preventive_action: "pa",
    verification_notes: "Verified on site",
    ...over,
  });

function seedNcr(mock: Mock, over: Record<string, unknown> = {}) {
  mock.on("ncrs", "select", (c) => {
    if (c.columns?.includes("capa_updated_by")) return { data: { capa_updated_by: null } };
    if (c.columns?.includes("client_acceptance_required")) return { data: { client_acceptance_required: false, client_acceptance_decision: null } };
    return { data: ncrRow(over) };
  });
  mock.on("ncrs", "update", { data: { id: "ncr-1", ncr_number: "NCR-001", project_id: "proj-1", raised_by: "raiser-1", itp_item_id: null, inspection_record_id: null, projects: { organization_id: "org-1" } } });
  mock.on("ncr_photos", "select", { data: [], count: 1 });
  mock.on("ncr_documents", "select", { data: [], count: 0 });
}

describe("updateNcrAction - close (verify) authority", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "verifier-1" }));
    audit.recordAuditEvent.mockClear();
    seedNcr(mock);
  });
  const close = (over: Record<string, string> = {}) => updateNcrAction({ error: null }, closeForm(over));

  it("requires CAPA text before it reads anything", async () => {
    expect((await close({ verification_notes: "" })).error).toMatch(/verification notes are required/);
    expect((await close({ preventive_action: "" })).error).toMatch(/Preventive action is required/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an inspector who holds no close_ncr permission and writes nothing", async () => {
    mock.onRpc("has_custom_permission", { data: false });
    const res = await close();
    expect(res.error).toMatch(/Only a JAGS admin, or someone granted the close NCR permission/);
    expect(mock.writes()).toHaveLength(0);
    expect(mock.rpcCalls[0]).toMatchObject({ name: "has_custom_permission", args: expect.objectContaining({ target_permission_key: "close_ncr", target_project_id: "proj-1" }) });
  });

  it("refuses an external user", async () => {
    testCtx.session = sessions.external();
    mock.onRpc("has_custom_permission", { data: false });
    expect((await close()).error).toMatch(/close NCR permission/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets a close_ncr permission holder close it (reaches the guarded write)", async () => {
    mock.onRpc("has_custom_permission", { data: true });
    const res = await close();
    expect(res.error).toBeNull();
    const [update] = mock.writes("ncrs", "update");
    expect(update.payload).toMatchObject({ status: "closed", closed_by: "verifier-1" });
    expect(update.filters).toContainEqual(["neq", "status", "closed"]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "ncr", action: "closed" }));
  });

  it("lets an admin close without consulting custom permissions", async () => {
    testCtx.session = sessions.admin({ userId: "verifier-1" });
    expect((await close()).error).toBeNull();
    expect(mock.rpcCalls.filter((r) => r.name === "has_custom_permission")).toHaveLength(0);
    expect(mock.writes("ncrs", "update")).toHaveLength(1);
  });

  it("only closes from pending verification", async () => {
    testCtx.session = sessions.admin();
    seedNcr(mock, { status: "in_progress" });
    expect((await close()).error).toMatch(/Send the NCR for verification first/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("will not close without evidence", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncr_photos", "select", { data: [], count: 0 });
    expect((await close()).error).toMatch(/Attach at least one photo/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("blocks the raiser from closing their own NCR unless they are admin", async () => {
    testCtx.session = sessions.inspector({ userId: "raiser-1" });
    mock.onRpc("has_custom_permission", { data: true });
    expect((await close()).error).toMatch(/different person must close/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("blocks the assignee (segregation of duties) and demands a written override from an admin", async () => {
    testCtx.session = sessions.inspector({ userId: "assignee-1" });
    mock.onRpc("has_custom_permission", { data: true });
    expect((await close()).error).toMatch(/different person must verify/);
    testCtx.session = sessions.admin({ userId: "assignee-1" });
    expect((await close()).error).toMatch(/override reason/);
    expect(mock.writes()).toHaveLength(0);
    expect((await close({ close_override_reason: "Sole qualified engineer on site" })).error).toBeNull();
    expect(mock.writes("ncrs", "update")[0].payload).toMatchObject({ close_override_reason: "Sole qualified engineer on site" });
  });

  it("holds the close until the client accepts when acceptance is required", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "select", (c) =>
      c.columns?.includes("client_acceptance_required")
        ? { data: { client_acceptance_required: true, client_acceptance_decision: null } }
        : c.columns?.includes("capa_updated_by")
          ? { data: { capa_updated_by: null } }
          : { data: ncrRow() }
    );
    expect((await close()).error).toMatch(/client has to accept/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("reports an NCR that closed meanwhile", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "update", { data: null });
    expect((await close()).error).toMatch(/already closed/);
  });
});

describe("withdrawNcrAction", () => {
  let mock: Mock;
  const withdraw = (over: Record<string, string> = {}) =>
    withdrawNcrAction({ error: null }, formData({ ncr_id: "ncr-1", reason: "Raised against the wrong item", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "someone-1" }));
    audit.recordAuditEvent.mockClear();
    mock.on("ncrs", "select", { data: ncrRow({ status: "in_progress" }) });
    mock.on("ncrs", "update", { data: { id: "ncr-1" } });
    mock.onRpc("has_custom_permission", { data: false });
  });

  it("requires a reason of at least five characters before touching the database", async () => {
    expect((await withdraw({ reason: "ok" })).error).toMatch(/reason/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an unrelated inspector without close permission", async () => {
    const res = await withdraw();
    expect(res.error).toMatch(/Only a JAGS admin or someone granted the close NCR permission/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses the raiser once the NCR has been started", async () => {
    testCtx.session = sessions.external({ userId: "raiser-1" });
    expect((await withdraw()).error).toMatch(/Only a JAGS admin/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets the raiser withdraw an NCR that has not been started", async () => {
    testCtx.session = sessions.external({ userId: "raiser-1" });
    mock.on("ncrs", "select", { data: ncrRow({ status: "open" }) });
    const res = await withdraw();
    expect(res).toEqual({ error: null, done: true });
    expect(mock.writes("ncrs", "update")[0].payload).toMatchObject({ status: "closed", withdrawn_by: "raiser-1", withdrawn_reason: "Raised against the wrong item" });
  });

  it("lets an admin withdraw, closes the linked punch items and audits", async () => {
    testCtx.session = sessions.admin();
    const res = await withdraw();
    expect(res.error).toBeNull();
    expect(mock.writeLog()).toEqual(["ncrs.update", "punch_list_items.update"]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "withdrawn" }));
  });

  it("never withdraws an already-closed NCR", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "select", { data: ncrRow({ status: "closed" }) });
    expect((await withdraw()).error).toMatch(/Only a JAGS admin/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("checks the duplicate target is on the same project", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "select", (c) => (c.columns === "id" ? { data: null } : { data: ncrRow({ status: "in_progress" }) }));
    const res = await withdraw({ duplicate_of_ncr_id: "ncr-9" });
    expect(res.error).toMatch(/duplicates was not found/);
    expect(mock.writes()).toHaveLength(0);
  });
});

describe("setNcrStatusAction", () => {
  let mock: Mock;
  const setStatus = (status: string) => setNcrStatusAction({ error: null }, formData({ ncr_id: "ncr-1", status }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.external({ userId: "stranger-1" }));
    mock.on("ncrs", "select", { data: ncrRow({ status: "open" }) });
    mock.on("ncrs", "update", { data: { ncr_number: "NCR-001", project_id: "proj-1", projects: { organization_id: "org-1" } } });
  });

  it("never lets the quick action set closed", async () => {
    expect((await setStatus("closed")).error).toMatch(/not allowed/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses a caller who is not the raiser, assignee, party or staff", async () => {
    const res = await setStatus("in_progress");
    expect(res.error).toMatch(/Only the raiser, the assignee/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets the assignee start work", async () => {
    testCtx.session = sessions.external({ userId: "assignee-1" });
    expect((await setStatus("in_progress")).error).toBeNull();
    expect(mock.writes("ncrs", "update")[0].payload).toEqual({ status: "in_progress" });
  });

  it("lets JAGS staff start work", async () => {
    testCtx.session = sessions.inspector();
    expect((await setStatus("in_progress")).error).toBeNull();
    expect(mock.writes("ncrs", "update")).toHaveLength(1);
  });
});
