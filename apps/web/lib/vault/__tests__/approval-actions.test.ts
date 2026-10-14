import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const decision = vi.hoisted(() => ({ notifyDocumentDecision: vi.fn(async () => undefined) }));
vi.mock("@/lib/vault/notifications", () => decision);

import { approveDocumentAction, rejectDocumentAction, setDocumentApproversAction } from "../multi-approval-actions";
import { bulkApproveDocumentsAction } from "../document-control-actions";

type Mock = ReturnType<typeof resetTestCtx>;

const approve = (over: Record<string, string> = {}) =>
  approveDocumentAction({ error: null }, formData({ document_id: "doc-1", project_id: "proj-1", folder_id: "fold-1", ...over }));
const reject = (over: Record<string, string> = {}) =>
  rejectDocumentAction({ error: null }, formData({ document_id: "doc-1", project_id: "proj-1", folder_id: "fold-1", reason: "Wrong revision", ...over }));

const approvedDoc = { id: "doc-1", folder_id: "fold-1", document_reference: "DWG-001", status: "approved" };

describe("approveDocumentAction (single approver path)", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    decision.notifyDocumentDecision.mockClear();
    mock.on("vault_document_approvers", "select", { data: [] });
    mock.on("vault_documents", "update", { data: [{ id: "doc-1" }] });
    mock.on("vault_documents", "select", { data: approvedDoc });
    mock.onRpc("has_custom_permission", { data: false });
    mock.onRpc("vault_approve_document", { data: true });
  });

  it("refuses an inspector without approve_vault_document and writes nothing", async () => {
    const res = await approve();
    expect(res.error).toMatch(/Only a JAGS Admin, or someone granted this permission/);
    expect(mock.writes()).toHaveLength(0);
    expect(mock.rpcCalls[0]).toMatchObject({ name: "has_custom_permission", args: expect.objectContaining({ target_permission_key: "approve_vault_document", target_project_id: "proj-1" }) });
  });

  it("refuses an external user", async () => {
    testCtx.session = sessions.external();
    expect((await approve()).error).toMatch(/Only a JAGS Admin/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets a permission holder approve through the atomic approve-and-retire function", async () => {
    mock.onRpc("has_custom_permission", { data: true });
    expect((await approve()).error).toBeNull();
    expect(mock.rpcCalls).toContainEqual({ name: "vault_approve_document", args: { p_document_id: "doc-1", p_approved_by: "inspector-1" } });
    // Retiring the earlier copy and approving happen inside that one function: no separate table writes.
    expect(mock.writes("vault_documents", "update")).toHaveLength(0);
    expect(decision.notifyDocumentDecision).toHaveBeenCalledWith(expect.anything(), "doc-1", "inspector-1", "approved");
  });

  it("lets an admin approve without a custom permission lookup", async () => {
    testCtx.session = sessions.admin();
    expect((await approve()).error).toBeNull();
    expect(mock.rpcCalls.map((c) => c.name)).toEqual(["vault_approve_document"]);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled(); // no org on the stubbed document row
  });

  it("reports a document that is no longer awaiting review", async () => {
    testCtx.session = sessions.admin();
    mock.onRpc("vault_approve_document", { data: false });
    expect((await approve()).error).toMatch(/no longer awaiting review/);
    expect(mock.writes("vault_documents", "update")).toHaveLength(0);
  });

  it("treats a concurrent finalisation (40001) as no longer awaiting review", async () => {
    testCtx.session = sessions.admin();
    mock.onRpc("vault_approve_document", { data: null, error: { code: "40001", message: "Document is no longer awaiting review" } });
    expect((await approve()).error).toMatch(/no longer awaiting review/);
  });

  it("falls back to approve-then-retire while the migration is not applied", async () => {
    testCtx.session = sessions.admin();
    mock.onRpc("vault_approve_document", { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    expect((await approve()).error).toBeNull();
    const updates = mock.writes("vault_documents", "update");
    expect(updates[0].payload).toMatchObject({ status: "approved", approved_by: expect.any(String) });
    expect(updates[0].filters).toContainEqual(["eq", "status", "for_review"]);
    expect(updates[1].payload).toMatchObject({ status: "superseded", superseded_by: "doc-1" });
    expect(updates[1].filters).toEqual(expect.arrayContaining([["eq", "document_reference", "DWG-001"], ["neq", "id", "doc-1"], ["neq", "status", "superseded"]]));
  });

  it("fallback retires nothing when the document has no reference", async () => {
    testCtx.session = sessions.admin();
    mock.onRpc("vault_approve_document", { data: null, error: { code: "PGRST202", message: "missing" } });
    mock.on("vault_documents", "select", { data: { ...approvedDoc, document_reference: null } });
    expect((await approve()).error).toBeNull();
    expect(mock.writes("vault_documents", "update")).toHaveLength(1);
  });

  it("an unauthenticated caller is redirected to login", async () => {
    testCtx.session = null;
    await expect(approve()).rejects.toBeInstanceOf(RedirectError);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("approveDocumentAction (named approvers)", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "approver-1" }));
    mock.onRpc("has_custom_permission", { data: true });
    mock.on("vault_documents", "update", { data: [{ id: "doc-1" }] });
    mock.on("vault_documents", "select", { data: { ...approvedDoc, status: "for_review" } });
    mock.onRpc("vault_approve_document", { data: true });
  });

  it("refuses someone who is not one of the named approvers, even with the general permission", async () => {
    mock.on("vault_document_approvers", "select", { data: [{ id: "r-9", approver_user_id: "someone-else", status: "pending" }] });
    expect((await approve()).error).toMatch(/aren't one of them/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("records the caller's own row but does not finalise while others are pending", async () => {
    mock.on("vault_document_approvers", "select", {
      data: [
        { id: "r-1", approver_user_id: "approver-1", status: "pending" },
        { id: "r-2", approver_user_id: "approver-2", status: "pending" },
      ],
    });
    expect((await approve()).error).toBeNull();
    expect(mock.writes("vault_document_approvers", "update")).toHaveLength(1);
    expect(mock.writes("vault_documents", "update")).toHaveLength(0);
  });

  it("finalises when the caller is the last pending approver", async () => {
    mock.on("vault_document_approvers", "select", {
      data: [
        { id: "r-1", approver_user_id: "approver-1", status: "pending" },
        { id: "r-2", approver_user_id: "approver-2", status: "approved" },
      ],
    });
    expect((await approve()).error).toBeNull();
    expect(mock.rpcCalls.filter((c) => c.name === "vault_approve_document")).toHaveLength(1);
  });
});

describe("rejectDocumentAction", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("vault_document_approvers", "select", { data: [] });
    mock.on("vault_documents", "update", { data: [{ id: "doc-1", title: "T", vault_folders: { project_id: "proj-1", projects: { organization_id: "org-1" } } }] });
    mock.onRpc("has_custom_permission", { data: false });
  });

  it("needs a reason of at least 5 characters", async () => {
    expect((await reject({ reason: "no" })).error).toMatch(/at least 5/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an inspector who is neither a named approver nor a permission holder", async () => {
    const res = await reject();
    expect(res.error).toMatch(/Only a JAGS Admin, a named approver/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets a named approver reject and marks their own row rejected", async () => {
    mock.on("vault_document_approvers", "select", { data: [{ id: "r-1", approver_user_id: "inspector-1" }] });
    expect((await reject()).error).toBeNull();
    expect(mock.writes("vault_documents", "update")[0].payload).toMatchObject({ status: "rejected", rejection_reason: "Wrong revision" });
    expect(mock.writes("vault_document_approvers", "update")[0].payload).toMatchObject({ status: "rejected" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "rejected" }));
  });

  it("lets an admin reject", async () => {
    testCtx.session = sessions.admin();
    expect((await reject()).error).toBeNull();
    expect(mock.writes("vault_documents", "update")).toHaveLength(1);
  });
});

describe("setDocumentApproversAction / bulkApproveDocumentsAction", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    mock.on("vault_document_approvers", "select", { data: [] });
    mock.on("vault_documents", "update", { data: [{ id: "doc-1" }] });
    mock.on("vault_documents", "select", { data: approvedDoc });
    mock.onRpc("has_custom_permission", { data: false });
    mock.onRpc("vault_approve_document", { data: true });
  });

  it("only a JAGS Admin can configure approvers", async () => {
    const res = await setDocumentApproversAction({ error: null }, formData({ document_id: "doc-1", project_id: "proj-1" }));
    expect(res.error).toMatch(/Only a JAGS Admin can set who must approve/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("bulk approve needs at least one document and reports per-document refusals", async () => {
    const empty = await bulkApproveDocumentsAction({ error: null }, formData({ project_id: "proj-1", folder_id: "fold-1" }));
    expect(empty.error).toMatch(/at least one/);
    const fd = formData({ project_id: "proj-1", folder_id: "fold-1" });
    fd.append("document_ids", "doc-1");
    fd.append("document_ids", "doc-2");
    const res = await bulkApproveDocumentsAction({ error: null }, fd);
    expect(res.approved).toBe(0);
    expect(res.skipped).toEqual([expect.stringMatching(/Only a JAGS Admin, or someone granted this permission/)]);
    expect(mock.writes()).toHaveLength(0);
  });

  it("bulk approve reaches the write for every document when the caller may approve", async () => {
    testCtx.session = sessions.admin();
    const fd = formData({ project_id: "proj-1", folder_id: "fold-1" });
    fd.append("document_ids", "doc-1");
    fd.append("document_ids", "doc-2");
    const res = await bulkApproveDocumentsAction({ error: null }, fd);
    expect(res.approved).toBe(2);
    expect(mock.rpcCalls.filter((c) => c.name === "vault_approve_document")).toHaveLength(2);
  });
});

describe("segregation of duties (uploader cannot approve own document)", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    mock.on("vault_document_approvers", "select", { data: [] });
    mock.on("vault_documents", "select", { data: { id: "doc-1", uploaded_by: "inspector-1", status: "for_review" } });
    mock.onRpc("has_custom_permission", { data: true });
    mock.onRpc("vault_approve_document", { data: true });
  });

  it("refuses the uploader and writes nothing", async () => {
    const res = await approve();
    expect(res.error).toMatch(/uploaded this document, so someone else must approve/);
    expect(mock.rpcCalls.map((c) => c.name)).not.toContain("vault_approve_document");
  });

  it("refuses an admin who uploaded it when no reason is given", async () => {
    testCtx.session = sessions.admin();
    mock.on("vault_documents", "select", { data: { id: "doc-1", uploaded_by: testCtx.session.userId, status: "for_review" } });
    expect((await approve()).error).toMatch(/at least 10 characters/);
    expect(mock.rpcCalls.map((c) => c.name)).not.toContain("vault_approve_document");
  });

  it("lets an admin approve their own upload with a reason, passed to the database", async () => {
    testCtx.session = sessions.admin();
    mock.on("vault_documents", "select", { data: { id: "doc-1", uploaded_by: testCtx.session.userId, status: "approved" } });
    expect((await approve({ override_reason: "Client urgent, no other approver" })).error).toBeNull();
    expect(mock.rpcCalls).toContainEqual({
      name: "vault_approve_document",
      args: { p_document_id: "doc-1", p_approved_by: testCtx.session.userId, p_override_reason: "Client urgent, no other approver" },
    });
  });
});
