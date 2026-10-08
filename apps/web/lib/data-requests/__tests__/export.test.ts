import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => {
  const m = await import("@/lib/test-utils/mock-supabase");
  return { ...m.sessionModule(), getSessionContext: async () => testCtx.session };
});
vi.mock("@/lib/supabase/service", () => ({ isServiceRoleConfigured: () => false, createSupabaseServiceRoleClient: () => ({}) }));
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);

import { NextRequest } from "next/server";
import { GET } from "@/app/inspect/organisation/data-requests/export/route";
import { buildExportText, EXPORT_SECTIONS, PROFILE_COLUMNS, exportFilename } from "../export";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const call = (qs = `?user_id=${USER_ID}`) => GET(new NextRequest(`http://localhost/inspect/organisation/data-requests/export${qs}`));

const target = { id: USER_ID, email: "pat@client.test", full_name: "Pat Client" };
const profile = { id: USER_ID, email: "pat@client.test", full_name: "Pat Client", is_active: true, is_jags_staff: false, staff_role: null };

describe("data subject export route", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    audit.recordAuditEvent.mockClear();
    mock.on("users", "select", (c) => (c.columns === "id, email, full_name" ? { data: target } : { data: [profile] }));
    mock.on("access_grants", "select", { data: [{ id: "g1", scope_type: "project", organization_id: "o1", project_id: "p1", role: "contractor", created_at: "2026-01-01" }] });
    mock.on("audit_log", "select", { data: [{ id: "a1", action: "closed", summary: "NCR closed", entity_type: "ncr", entity_id: "n1", created_at: "2026-02-02" }] });
    mock.on("notifications", "select", { data: [{ id: "n1", title: "Your NCR was closed", body: null, link: "/inspect/ncrs/n1", is_read: true }] });
  });

  it("refuses anonymous, inspector and external callers before reading anything", async () => {
    testCtx.session = null;
    expect((await call()).status).toBe(401);
    testCtx.session = sessions.inspector();
    expect((await call()).status).toBe(403);
    testCtx.session = sessions.external();
    expect((await call()).status).toBe(403);
    expect(mock.calls).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed user id and an unknown account", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("?user_id=not-a-uuid")).status).toBe(400);
    mock.on("users", "select", { data: null });
    expect((await call()).status).toBe(404);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("streams a JSON attachment for a JAGS Admin and audit-logs the export without naming the person", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`attachment; filename="data-export-${USER_ID}-\\d{8}\\.json"`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const doc = JSON.parse(await res.text());
    expect(doc.export_version).toBe(1);
    expect(doc.subject_user_id).toBe(USER_ID);
    expect(doc.profile).toMatchObject({ email: "pat@client.test", full_name: "Pat Client" });
    expect(doc.sections.access_grants.rows).toHaveLength(1);
    expect(doc.sections.audit_events_performed.rows[0].action).toBe("closed");
    expect(doc.sections.notifications_received.rows[0].title).toBe("Your NCR was closed");
    expect(doc.row_counts.access_grants).toBe(1);
    expect(doc.complete).toBe(true);
    expect(doc.read_with).toBe("user_session");

    expect(audit.recordAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = audit.recordAuditEvent.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(event).toMatchObject({ entityType: "user", entityId: USER_ID, action: "data_exported", actorId: "admin-1" });
    expect(String(event.summary)).not.toMatch(/pat@client|Pat Client/);
    // A read-only operation: nothing was written.
    expect(mock.writes()).toHaveLength(0);
  });
});

describe("export document shape", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.admin());
    mock.on("users", "select", { data: [profile] });
  });
  const build = () => buildExportText(mock.client, target, { generatedAt: new Date("2026-10-08T00:00:00Z"), generatedBy: "admin-1", readWith: "service_role" });

  it("queries every section by the user's id with explicit columns, never '*'", async () => {
    await build();
    for (const section of EXPORT_SECTIONS) {
      const call = mock.calls.find((c) => c.table === section.table && c.columns === section.columns);
      expect(call, section.key).toBeDefined();
      expect(call?.filters).toContainEqual(["eq", section.column, USER_ID]);
      expect(section.columns).not.toContain("*");
    }
    expect(mock.calls.find((c) => c.table === "users")?.columns).toBe(PROFILE_COLUMNS);
  });

  it("never selects secrets or bulky content", () => {
    const all = [...EXPORT_SECTIONS.map((s) => s.columns).join(",").split(","), ...PROFILE_COLUMNS.split(",")].map((c) => c.trim());
    for (const forbidden of ["signature_data", "inspector_signature", "witness_signature", "ai_response", "reviewed_response", "source_ref", "password", "token", "secret", "recipient_email", "last_error", "*"]) {
      expect(all, forbidden).not.toContain(forbidden);
    }
  });

  it("covers the sections the process promises", () => {
    const keys = EXPORT_SECTIONS.map((s) => s.key);
    for (const k of ["access_grants", "party_memberships", "audit_events_performed", "notifications_received", "inspections_signed", "inspection_photos", "comments", "ai_usage"]) {
      expect(keys).toContain(k);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("pages large sections and emits valid JSON", async () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
    mock.on("audit_log", "select", (c) => {
      const range = c.filters.find((f) => f[0] === "range");
      return { data: range && range[1] === 0 ? rows(1000) : rows(5) };
    });
    const doc = JSON.parse(await build());
    expect(doc.row_counts.audit_events_performed).toBe(1005);
    expect(doc.sections.audit_events_performed.rows).toHaveLength(1005);
  });

  it("reports a section that cannot be read instead of silently shortening the file", async () => {
    mock.on("ai_usage_log", "select", { error: { message: "relation does not exist" } });
    const doc = JSON.parse(await build());
    expect(doc.complete).toBe(false);
    expect(doc.unavailable_sections).toEqual([{ section: "ai_usage", error: "relation does not exist" }]);
    expect(doc.sections.ai_usage.rows).toEqual([]);
  });

  it("falls back to the base profile columns when the newer ones are missing", async () => {
    mock.on("users", "select", (c) => (c.columns === PROFILE_COLUMNS ? { error: { message: "column terms_version does not exist" } } : { data: [profile] }));
    const doc = JSON.parse(await build());
    expect(doc.profile.email).toBe("pat@client.test");
    expect(doc.complete).toBe(true);
  });

  it("builds a safe file name from the id only", () => {
    expect(exportFilename(USER_ID, new Date("2026-10-08T12:00:00Z"))).toBe(`data-export-${USER_ID}-20261008.json`);
  });
});
