import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "10.0.0.1" }), cookies: async () => ({ getAll: () => [] }) }));
vi.mock("@/lib/supabase/service", () => ({ isServiceRoleConfigured: () => false, createSupabaseServiceRoleClient: () => ({}) }));
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/email", () => ({ sendNotificationEmail: vi.fn(async () => undefined) }));
const readiness = vi.hoisted(() => ({ computeDataBookReadiness: vi.fn() }));
vi.mock("@/lib/databook/readiness", () => readiness);
vi.mock("@/lib/databook/override-items", () => ({ buildOverrideItems: vi.fn(async () => []) }));
vi.mock("../package-hash", () => ({
  verifyStoredPackageHash: vi.fn(async (_c: unknown, _b: string, _p: string, sha: string) => ({ ok: true, sha256: sha, bytes: 10 })),
}));
vi.mock("../certificate-pdf", () => ({ queueHandoverCertificatePdf: vi.fn(async () => true), queueIssuedDataBookPdf: vi.fn(async () => true) }));

import { acknowledgeHandoverAction, issueHandoverAction, reopenHandoverRejectionAction, rejectHandoverAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const SHA = "a".repeat(64);
const readyCategory = { label: "x", total: 1, ready: 1, percentage: 100 };
const readyReadiness = () => ({
  isReady: true,
  openPunchItems: 0,
  ...Object.fromEntries(
    ["itps", "inspectionRecords", "checklists", "calibrationRegister", "welderRegister", "personnelRegister", "materialRegister", "standaloneAssignments", "ncrs", "activitiesExecuted", "holdPoints"].map((k) => [k, readyCategory])
  ),
});

const issueForm = (over: Record<string, string> = {}) =>
  formData({ data_book_id: "book-1", project_id: "proj-1", package_storage_path: "handover/book-1/pkg.zip", package_sha256: SHA, ...over });

describe("issueHandoverAction", () => {
  let mock: Mock;
  const book = (over: Record<string, unknown> = {}) => ({ id: "book-1", project_id: "proj-1", book_number: "DB-1", status: "compiled", override_open_punch_items: false, override_reason: null, override_items: [], ...over });
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    readiness.computeDataBookReadiness.mockReset().mockResolvedValue(readyReadiness());
    mock.on("data_books", "select", { data: book() });
    mock.on("projects", "select", { data: { organization_id: "org-1", status: "completed" } });
    mock.onRpc("issue_data_book_handover", { data: "cert-1" });
    mock.on("handover_certificates", "select", { data: { certificate_number: "HC-1" } });
  });
  const issue = (over: Record<string, string> = {}) => issueHandoverAction({ error: null }, issueForm(over));
  const rpcNames = () => mock.rpcCalls.map((r) => r.name);

  it("refuses a package path outside this book's folder before authenticating", async () => {
    const res = await issue({ package_storage_path: "handover/other-book/pkg.zip" });
    expect(res.error).toMatch(/package reference is invalid/);
    expect(rpcNames()).not.toContain("issue_data_book_handover");
  });

  it("refuses a malformed fingerprint", async () => {
    expect((await issue({ package_sha256: "nope" })).error).toMatch(/fingerprint is invalid/);
    expect(rpcNames()).not.toContain("issue_data_book_handover");
  });

  it("refuses non-staff and never reaches the issue RPC", async () => {
    testCtx.session = sessions.external();
    const res = await issue();
    expect(res.error).toMatch(/Only JAGS staff can issue/);
    expect(rpcNames()).not.toContain("issue_data_book_handover");
  });

  it("only issues a compiled book", async () => {
    mock.on("data_books", "select", { data: book({ status: "draft" }) });
    expect((await issue()).error).toMatch(/Only a compiled Data Book/);
    expect(rpcNames()).not.toContain("issue_data_book_handover");
  });

  it("fails closed when readiness cannot be computed", async () => {
    readiness.computeDataBookReadiness.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await issue()).error).toMatch(/Could not verify the Data Book readiness/);
    expect(rpcNames()).not.toContain("issue_data_book_handover");
  });

  it("refuses an unready project when the book carries no override", async () => {
    readiness.computeDataBookReadiness.mockResolvedValue({ ...readyReadiness(), isReady: false, openPunchItems: 2 });
    expect((await issue()).error).toMatch(/no longer ready/);
    expect(rpcNames()).not.toContain("issue_data_book_handover");
  });

  it("lets staff issue a ready book through the atomic RPC with the server-verified hash, and audits", async () => {
    const res = await issue();
    expect(res).toEqual({ error: null, notice: null });
    expect(mock.rpcCalls.find((r) => r.name === "issue_data_book_handover")?.args).toMatchObject({
      p_data_book_id: "book-1",
      p_package_storage_path: "handover/book-1/pkg.zip",
      p_package_sha256: SHA,
    });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entityType: "handover_certificate", action: "issued" }));
  });

  describe("conditional handover (book compiled with an override)", () => {
    beforeEach(() => {
      mock.on("data_books", "select", { data: book({ override_open_punch_items: true }) });
    });

    it("refuses an inspector without the issue_handover permission", async () => {
      mock.onRpc("has_custom_permission", { data: false });
      const res = await issue();
      expect(res.error).toMatch(/Only a JAGS Admin or a holder of the issue_handover permission/);
      expect(rpcNames()).not.toContain("issue_data_book_handover");
      expect(mock.writes("data_books")).toHaveLength(0);
    });

    it("lets an inspector holding issue_handover issue it", async () => {
      mock.onRpc("has_custom_permission", { data: true });
      expect((await issue()).error).toBeNull();
      expect(rpcNames()).toContain("issue_data_book_handover");
      expect(mock.writes("data_books", "update")).toHaveLength(1);
    });

    it("lets an admin issue it without a custom permission", async () => {
      testCtx.session = sessions.admin();
      expect((await issue()).error).toBeNull();
      expect(rpcNames()).not.toContain("has_custom_permission");
      expect(rpcNames()).toContain("issue_data_book_handover");
    });
  });

  it("maps an RPC refusal to a message and does not audit", async () => {
    mock.onRpc("issue_data_book_handover", { error: { code: "P0001", message: "boom" } });
    const res = await issue();
    expect(res.error).toBeTruthy();
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("acknowledgeHandoverAction", () => {
  let mock: Mock;
  const ack = (over: Record<string, string> = {}) =>
    acknowledgeHandoverAction({ error: null }, formData({ certificate_id: "cert-1", received_by_name: "Pat Client", confirm: "on", ...over }));
  const rpcNames = () => mock.rpcCalls.map((r) => r.name);
  beforeEach(() => {
    mock = resetTestCtx(sessions.external({ grants: [{ scope_type: "project", organization_id: "org-1", project_id: "proj-1", role: "client" }] }));
    mock.onRpc("acknowledge_handover", { data: null, error: null });
  });

  it("validates name and confirmation before authorising", async () => {
    expect((await ack({ received_by_name: "" })).error).toMatch(/name is required/);
    expect((await ack({ confirm: "" })).error).toMatch(/confirmation box/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("refuses a non-client external user", async () => {
    testCtx.session = sessions.external({ grants: [{ scope_type: "project", organization_id: "org-1", project_id: "proj-1", role: "subcontractor" }] });
    expect((await ack()).error).toMatch(/Only the client organisation/);
    expect(rpcNames()).not.toContain("acknowledge_handover");
  });

  it("refuses an inspector (staff but not admin)", async () => {
    testCtx.session = sessions.inspector();
    expect((await ack({ on_behalf_basis: "email of 1 June" })).error).toMatch(/Only the client organisation/);
    expect(rpcNames()).not.toContain("acknowledge_handover");
  });

  it("lets the client acknowledge for itself", async () => {
    const res = await ack();
    expect(res.error).toBeNull();
    expect(mock.rpcCalls.find((r) => r.name === "acknowledge_handover")?.args).toMatchObject({ target_certificate_id: "cert-1", received_name: "Pat Client", p_on_behalf_basis: null, p_user_agent: "vitest", p_ip: "10.0.0.1" });
  });

  it("makes an admin record how the client confirmed when acting on their behalf", async () => {
    testCtx.session = sessions.admin();
    expect((await ack()).error).toMatch(/how the client confirmed/);
    expect(rpcNames()).not.toContain("acknowledge_handover");
    expect((await ack({ on_behalf_basis: "Signed PDF ref 77" })).error).toBeNull();
    expect(mock.rpcCalls.find((r) => r.name === "acknowledge_handover")?.args).toMatchObject({ p_on_behalf_basis: "Signed PDF ref 77" });
  });

  it("surfaces the database's already-acknowledged refusal", async () => {
    mock.onRpc("acknowledge_handover", { error: { code: "P0001", message: "Already acknowledged" } });
    expect((await ack()).error).toMatch(/already been acknowledged/);
  });

  it("rejects an evidence path that is not under this book's acknowledgement folder", async () => {
    mock.on("handover_certificates", "select", { data: { data_book_id: "book-1" } });
    const res = await ack({ evidence_path: "handover/other/x.pdf" });
    expect(res.error).toMatch(/supporting file reference was rejected/);
    expect(rpcNames()).not.toContain("acknowledge_handover");
  });
});

describe("rejectHandoverAction / reopenHandoverRejectionAction", () => {
  let mock: Mock;
  const reject = (over: Record<string, string> = {}) =>
    rejectHandoverAction({ error: null }, formData({ certificate_id: "cert-1", reject_reason: "Missing as-built drawings", confirm: "on", ...over }));
  const rpcNames = () => mock.rpcCalls.map((r) => r.name);
  beforeEach(() => {
    mock = resetTestCtx(sessions.external({ grants: [{ scope_type: "project", organization_id: "org-1", project_id: "proj-1", role: "client" }] }));
    mock.onRpc("reject_handover", { data: null, error: null });
    mock.onRpc("reopen_handover_rejection", { data: null, error: null });
  });

  it("requires a reason of at least 10 characters and the confirmation", async () => {
    expect((await reject({ reject_reason: "bad" })).error).toMatch(/at least 10/);
    expect((await reject({ confirm: "" })).error).toMatch(/confirmation box/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("refuses staff and non-client parties", async () => {
    testCtx.session = sessions.admin();
    expect((await reject()).error).toMatch(/Only the client organisation/);
    testCtx.session = sessions.external({ grants: [{ scope_type: "project", organization_id: "org-1", project_id: "proj-1", role: "main_contractor" }] });
    expect((await reject()).error).toMatch(/Only the client organisation/);
    expect(rpcNames()).not.toContain("reject_handover");
  });

  it("lets the client reject, passing the reason to the SECURITY DEFINER function", async () => {
    expect((await reject()).error).toBeNull();
    expect(mock.rpcCalls.find((r) => r.name === "reject_handover")?.args).toMatchObject({ target_certificate_id: "cert-1", p_reason: "Missing as-built drawings" });
  });

  it("maps a database refusal for an already-acknowledged certificate", async () => {
    mock.onRpc("reject_handover", { error: { message: "already acknowledged" } });
    expect((await reject()).error).toMatch(/already been acknowledged/);
  });

  it("only an admin can reopen a rejection", async () => {
    const reopen = () => reopenHandoverRejectionAction({ error: null }, formData({ certificate_id: "cert-1", reopen_reason: "Rejected in error by PM" }));
    expect((await reopen()).error).toMatch(/Only a JAGS Admin/);
    testCtx.session = sessions.inspector();
    expect((await reopen()).error).toMatch(/Only a JAGS Admin/);
    expect(rpcNames()).not.toContain("reopen_handover_rejection");
    testCtx.session = sessions.admin();
    expect((await reopen()).error).toBeNull();
    expect(rpcNames()).toContain("reopen_handover_rejection");
  });
});
