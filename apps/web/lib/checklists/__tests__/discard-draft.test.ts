import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, formData, resetTestCtx, sessions } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
vi.mock("next/navigation", async () => (await import("@/lib/test-utils/mock-supabase")).nextNavigationModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/vault/irn-void", () => ({ supersedeIrnVaultDocuments: vi.fn() }));
vi.mock("../irn-notifications", () => ({ notifyAfterIrnVoided: vi.fn(), notifyInspectorReopened: vi.fn() }));

import { discardInspectionDraftAction } from "../lifecycle-actions";

const run = (fields: Record<string, string> = {}) =>
  discardInspectionDraftAction({ error: null }, formData({ inspection_record_id: "rec-1", reason: "Started by mistake", ...fields }));

describe("discardInspectionDraftAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.onRpc("discard_inspection_draft", { data: { record_number: "R-1", project_id: "proj-1", photo_paths: ["proj-1/rec-1/a.jpg"] } });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
  });

  it("requires a record and a reason before calling the database", async () => {
    expect((await run({ inspection_record_id: "" })).error).toMatch(/Missing inspection record/);
    expect((await run({ reason: "no" })).error).toMatch(/short reason/);
    expect(mock.rpcCalls).toHaveLength(0);
  });

  it("surfaces the database refusal for a completed inspection", async () => {
    mock.onRpc("discard_inspection_draft", { error: { message: "A completed inspection cannot be discarded; re-open it instead", code: "42501" } });
    expect((await run()).error).toMatch(/completed inspection cannot be discarded/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("discards, removes photo files, audits and redirects", async () => {
    await expect(run()).rejects.toBeInstanceOf(RedirectError);
    expect(mock.rpcCalls[0]).toEqual({ name: "discard_inspection_draft", args: { p_record_id: "rec-1", p_reason: "Started by mistake" } });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "draft_discarded", entityId: "rec-1" }));
  });
});
