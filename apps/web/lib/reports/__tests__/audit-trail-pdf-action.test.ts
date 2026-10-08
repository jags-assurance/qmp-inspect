import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/ai/gate", () => ({ assertAiAllowed: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ aiErrorMessage: () => "ai error" }));
vi.mock("@/lib/ai/sanitize", () => ({ sanitizeAiText: (s: string) => s }));
vi.mock("@/lib/ai/log", () => ({ logAiUsage: vi.fn(), recordAiReviewDecision: vi.fn() }));
vi.mock("@/lib/ai/cache", () => ({ findCachedAiResponse: vi.fn(), hashAiCacheInput: vi.fn() }));
vi.mock("@/lib/ai/gemini-provider", () => ({ geminiProvider: {}, getGeminiModel: () => "m", PROMPT_VERSIONS: {}, withGeminiUsage: vi.fn() }));
vi.mock("@/lib/standalone/actions", () => ({ canRunStandaloneAssignment: vi.fn() }));

import { requestAuditTrailPdfAction } from "../actions";

describe("requestAuditTrailPdfAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const req = (over: Record<string, string> = {}) =>
    requestAuditTrailPdfAction({ error: null }, formData({ project_id: "p1", range: "all", cat: "ncr", actor: "", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "staff-1" }));
    audit.recordAuditEvent.mockClear();
    mock.on("projects", "select", { data: { id: "p1", organization_id: "org-1" } });
    mock.on("background_jobs", "select", { data: [] });
    mock.on("background_jobs", "insert", { data: [{ id: "j1" }] });
  });

  it("refuses non-staff before touching the database", async () => {
    testCtx.session = sessions.external();
    expect((await req()).error).toMatch(/only available to JAGS staff/);
    expect(mock.calls).toHaveLength(0);
  });

  it("queues the job with the resolved filters and audit-logs the export", async () => {
    expect(await req()).toEqual({ error: null, success: true });
    const [ins] = mock.writes("background_jobs", "insert");
    expect(ins.payload).toEqual({ job_type: "render_audit_trail_pdf", payload: { project_id: "p1", requested_by: "staff-1", from_iso: null, cat: "ncr", actor: null } });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "audit_log_exported", projectId: "p1" }));
  });

  it("does not queue a second job while one is in flight", async () => {
    mock.on("background_jobs", "select", { data: [{ id: "j0" }] });
    expect((await req()).success).toBe(true);
    expect(mock.writes("background_jobs", "insert")).toHaveLength(0);
  });

  it("explains a missing migration instead of a generic failure", async () => {
    mock.on("background_jobs", "insert", { error: { code: "23514", message: 'violates check constraint "background_jobs_job_type_check"' } });
    expect((await req()).error).toMatch(/pending database update/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("404s for an inaccessible project", async () => {
    mock.on("projects", "select", { data: null });
    expect((await req()).error).toMatch(/not found/);
  });
});
