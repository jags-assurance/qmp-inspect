import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => {
  const m = await import("@/lib/test-utils/mock-supabase");
  return { ...m.sessionModule(), getSessionContext: async () => testCtx.session };
});
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);

import { NextRequest } from "next/server";
import { GET } from "@/app/inspect/projects/[projectId]/audit-log/export/route";

const call = (qs = "") =>
  GET(new NextRequest(`http://localhost/inspect/projects/p1/audit-log/export${qs}`), { params: Promise.resolve({ projectId: "p1" }) });

const ev = (id: string, summary: string) => ({
  id,
  entity_type: "ncr",
  entity_id: "n1",
  action: "closed",
  summary,
  changes: null,
  created_at: "2026-03-04T05:06:07Z",
  actor_id: "u1",
  actor: { full_name: "Ada", email: "ada@x.test" },
});

describe("audit log CSV export route", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("projects", "select", { data: { id: "p1", project_number: "P-1", name: "Tower", organization_id: "org-1" } });
    mock.on("audit_log", "select", (c) => {
      const r = c.filters.find((f) => f[0] === "range");
      return { data: r && r[1] === 0 ? [ev("1", "plain"), ev("2", "=1+1")] : [] };
    });
  });

  it("rejects anonymous and non-staff callers before reading anything", async () => {
    testCtx.session = null;
    expect((await call()).status).toBe(401);
    testCtx.session = sessions.external();
    expect((await call()).status).toBe(403);
    expect(mock.calls).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("returns an escaped CSV attachment, applies filters and audit-logs the export", async () => {
    const res = await call("?range=all&cat=ncr");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/audit-log-P-1-\d{4}-\d{2}-\d{2}\.csv/);
    const text = await res.text();
    expect(text).toContain("Timestamp (UTC)");
    expect(text).toContain("'=1+1");
    expect(text).toContain("plain");
    const q = mock.calls.find((c) => c.table === "audit_log");
    expect(q?.filters).toContainEqual(["eq", "entity_type", "ncr"]);
    expect(q?.filters.some((f) => f[0] === "gte")).toBe(false);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "audit_log_exported", projectId: "p1", entityType: "project" })
    );
  });

  it("404s for a project the caller cannot see", async () => {
    mock.on("projects", "select", { data: null });
    expect((await call()).status).toBe(404);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});
