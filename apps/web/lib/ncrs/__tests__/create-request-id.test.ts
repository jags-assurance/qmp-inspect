import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, RedirectError, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
vi.mock("@/lib/audit/log", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn(), recordAiReviewDecision: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
const punch = vi.hoisted(() => ({ createPunchItemFromSource: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/punch-list/actions", () => punch);
const numbering = vi.hoisted(() => ({ generateDocumentNumber: vi.fn() }));
vi.mock("@/lib/numbering/generate", () => numbering);
vi.mock("@/lib/vault/supersede-refs", () => ({ supersedeVaultDocumentsByReference: vi.fn() }));

import { createNcrAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const raise = (over: Record<string, string> = {}) =>
  createNcrAction(
    { error: null },
    formData({
      project_id: "proj-1",
      severity: "major_ncr",
      description: "Weld seam 4 shows undercut beyond the limit",
      stay_on_page: "true",
      ...over,
    })
  );

describe("createNcrAction - request_id idempotency (ncrs unique project_id + request_id)", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "raiser-1" }));
    punch.createPunchItemFromSource.mockClear();
    numbering.generateDocumentNumber.mockReset();
    numbering.generateDocumentNumber.mockResolvedValue({ documentNumber: "NCR-001" });
    mock.on("projects", "select", { data: { project_number: "PRJ-1", organization_id: "org-1" } });
    mock.on("ncrs", "select", { data: null });
    mock.on("ncrs", "insert", { data: { id: "ncr-new" } });
  });

  it("validates before it touches the database", async () => {
    expect((await raise({ severity: "" })).error).toMatch(/required/);
    expect((await raise({ severity: "catastrophic" })).error).toMatch(/Invalid severity/);
    expect((await raise({ description: "too short" })).error).toMatch(/at least 10 characters/);
    expect(mock.calls).toHaveLength(0);
  });

  it("no longer raises a minor NCR (an NCR is for a serious problem; a small finding is an Observation)", async () => {
    expect((await raise({ severity: "minor_ncr" })).error).toMatch(/Minor NCRs are no longer raised/);
    expect(mock.calls).toHaveLength(0);
  });

  it("returns the NCR the first attempt created and burns no number when the request_id was seen", async () => {
    mock.on("ncrs", "select", { data: { id: "ncr-first", ncr_number: "NCR-007" } });
    const res = await raise({ request_id: "req-1" });
    expect(res).toEqual({ error: null, created: { id: "ncr-first", ncrNumber: "NCR-007" } });
    const lookup = mock.calls.find((c) => c.table === "ncrs");
    expect(lookup?.filters).toContainEqual(["eq", "project_id", "proj-1"]);
    expect(lookup?.filters).toContainEqual(["eq", "request_id", "req-1"]);
    expect(mock.writes()).toHaveLength(0);
    expect(numbering.generateDocumentNumber).not.toHaveBeenCalled();
    expect(punch.createPunchItemFromSource).not.toHaveBeenCalled();
  });

  it("redirects to the existing NCR when the caller is not staying on the page", async () => {
    mock.on("ncrs", "select", { data: { id: "ncr-first", ncr_number: "NCR-007" } });
    await expect(raise({ request_id: "req-1", stay_on_page: "" })).rejects.toThrow(new RedirectError("/inspect/ncrs/ncr-first"));
    expect(mock.writes()).toHaveLength(0);
  });

  it("stores the sanitised request_id on the new row", async () => {
    const res = await raise({ request_id: "ab/c d-1" });
    expect(res.created).toEqual({ id: "ncr-new", ncrNumber: "NCR-001" });
    const [insert] = mock.writes("ncrs", "insert");
    expect(insert.payload).toMatchObject({ project_id: "proj-1", request_id: "abcd-1", raised_by: "raiser-1" });
  });

  it("does not look up or store a request_id when none was sent", async () => {
    await raise();
    expect(mock.calls.filter((c) => c.table === "ncrs" && c.op === "select")).toHaveLength(0);
    expect(mock.writes("ncrs", "insert")[0].payload).not.toHaveProperty("request_id");
  });

  it("returns the winner when a simultaneous request hit the unique index (23505 on ncrs_project_request_id_uidx)", async () => {
    mock.onOnce("ncrs", "select", { data: null }); // fast-path lookup: nothing yet
    mock.on("ncrs", "insert", { error: { code: "23505", message: 'duplicate key value violates unique constraint "ncrs_project_request_id_uidx"' } });
    mock.onOnce("ncrs", "select", { data: { id: "ncr-winner", ncr_number: "NCR-002" } }); // lookup after the conflict
    const res = await raise({ request_id: "req-9" });
    expect(res).toEqual({ error: null, created: { id: "ncr-winner", ncrNumber: "NCR-002" } });
    expect(mock.writes("ncrs", "insert")).toHaveLength(1);
    expect(punch.createPunchItemFromSource).not.toHaveBeenCalled();
  });

  it("retries a plain number collision (23505 on ncr_number) with a fresh number, then succeeds", async () => {
    numbering.generateDocumentNumber.mockResolvedValueOnce({ documentNumber: "NCR-001" }).mockResolvedValueOnce({ documentNumber: "NCR-002" });
    mock.onOnce("ncrs", "insert", { error: { code: "23505", message: 'duplicate key value violates unique constraint "ncrs_project_id_ncr_number_key"' } });
    const res = await raise({ request_id: "req-2" });
    expect(res.created).toEqual({ id: "ncr-new", ncrNumber: "NCR-002" });
    expect(numbering.generateDocumentNumber).toHaveBeenCalledTimes(2);
  });

  it("gives up after five collisions with a message about the numbering configuration", async () => {
    mock.on("ncrs", "insert", { error: { code: "23505", message: "duplicate key value violates unique constraint \"ncrs_project_id_ncr_number_key\"" } });
    expect((await raise()).error).toMatch(/Could not generate a unique NCR number after several attempts/);
    expect(numbering.generateDocumentNumber).toHaveBeenCalledTimes(5);
  });

  it("does not retry other database errors (e.g. a refused insert)", async () => {
    mock.on("ncrs", "insert", { error: { code: "42501", message: "new row violates row-level security policy" } });
    const res = await raise();
    expect(res.error).toBeTruthy();
    expect(res.created).toBeUndefined();
    expect(numbering.generateDocumentNumber).toHaveBeenCalledTimes(1);
  });

  it("an observation gets no punch item; a minor or major NCR does", async () => {
    await raise({ severity: "observation" });
    expect(punch.createPunchItemFromSource).not.toHaveBeenCalled();
    await raise({ severity: "major_ncr" });
    expect(punch.createPunchItemFromSource).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-1", source: "ncr", sourceNcrId: "ncr-new" }));
  });

  it("reports a project the caller cannot see and raises nothing", async () => {
    mock.on("projects", "select", { data: null });
    expect((await raise({ request_id: "req-1" })).error).toMatch(/Project not found/);
    expect(mock.writes()).toHaveLength(0);
  });
});
