import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
vi.mock("@/lib/notifications/helpers", () => ({ createNotification: vi.fn(async () => undefined) }));

import { recordClientAcceptanceAction, setClientAcceptanceRequiredAction } from "../acceptance-actions";

const ncr = (over: Record<string, unknown> = {}) => ({
  status: "in_progress",
  project_id: "proj-1",
  ncr_number: "NCR-001",
  raised_by: "inspector-9",
  assigned_to: null,
  disposition: "use_as_is",
  withdrawn_at: null,
  client_acceptance_required: true,
  client_acceptance_decision: null,
  projects: { organization_id: "org-1" },
  ...over,
});
const accept = (fields: Record<string, string> = {}) =>
  recordClientAcceptanceAction({ error: null }, formData({ ncr_id: "ncr-1", decision: "accepted", comment: "", ...fields }));

describe("setClientAcceptanceRequiredAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector());
    audit.recordAuditEvent.mockClear();
    mock.on("ncrs", "select", { data: ncr() });
    mock.on("ncrs", "update", { data: [{ id: "ncr-1" }] });
  });
  const set = (required: boolean) => setClientAcceptanceRequiredAction({ error: null }, formData({ ncr_id: "ncr-1", required }));

  it("refuses non-staff without reading the NCR", async () => {
    testCtx.session = sessions.external();
    expect((await set(true)).error).toMatch(/Only JAGS staff/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses to change a closed NCR", async () => {
    mock.on("ncrs", "select", { data: ncr({ status: "closed" }) });
    expect((await set(true)).error).toMatch(/already closed/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets staff flip the flag and clears any earlier decision", async () => {
    const res = await set(true);
    expect(res).toEqual({ error: null, done: true });
    expect(mock.writes("ncrs", "update")[0].payload).toMatchObject({
      client_acceptance_required: true,
      client_accepted_at: null,
      client_accepted_by: null,
      client_acceptance_decision: null,
    });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "client_acceptance_required" }));
  });

  it("explains a missing migration instead of failing opaquely", async () => {
    mock.on("ncrs", "update", { error: { code: "42703", message: "column does not exist" } });
    expect((await set(true)).error).toMatch(/database update/);
  });
});

describe("recordClientAcceptanceAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  beforeEach(() => {
    mock = resetTestCtx(sessions.external({ userId: "client-1" }));
    audit.recordAuditEvent.mockClear();
    mock.on("ncrs", "select", { data: ncr() });
    mock.on("ncrs", "update", { data: { id: "ncr-1" } });
    mock.on("project_parties", "select", { data: [{ id: "party-1", user_id: "client-1" }] });
  });

  it("validates the input before anything is read or authenticated against data", async () => {
    expect((await accept({ decision: "maybe" })).error).toMatch(/accept or reject/);
    expect((await accept({ decision: "rejected", comment: "no" })).error).toMatch(/why/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses an external user who is not a client party of the project", async () => {
    mock.on("project_parties", "select", { data: [{ id: "party-1", user_id: "someone-else" }] });
    mock.on("project_party_members", "select", { data: [] });
    const res = await accept();
    expect(res.error).toMatch(/client's own login/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses a non-client user when the project has no client party at all", async () => {
    mock.on("project_parties", "select", { data: [] });
    expect((await accept()).error).toMatch(/client's own login/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses an inspector (staff but not admin) who is not a client party", async () => {
    testCtx.session = sessions.inspector();
    mock.on("project_parties", "select", { data: [] });
    expect((await accept()).error).toMatch(/client's own login/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses when acceptance was not required, the NCR was withdrawn or has no disposition", async () => {
    mock.on("ncrs", "select", { data: ncr({ client_acceptance_required: false }) });
    expect((await accept()).error).toMatch(/not required/);
    mock.on("ncrs", "select", { data: ncr({ withdrawn_at: "2026-01-01" }) });
    expect((await accept()).error).toMatch(/withdrawn/);
    mock.on("ncrs", "select", { data: ncr({ disposition: null }) });
    expect((await accept()).error).toMatch(/disposition/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets the client's own login accept: reaches the guarded write and audits", async () => {
    const res = await accept({ decision: "accepted", comment: "Fine by us" });
    expect(res).toEqual({ error: null, done: true });
    const [update] = mock.writes("ncrs", "update");
    expect(update.payload).toMatchObject({ client_accepted_by: "client-1", client_acceptance_decision: "accepted", client_acceptance_comment: "Fine by us" });
    expect(update.filters).toContainEqual(["neq", "status", "closed"]);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "client_accepted" }));
  });

  it("accepts a client team member who is not the primary party login", async () => {
    mock.on("project_parties", "select", { data: [{ id: "party-1", user_id: "primary" }] });
    mock.on("project_party_members", "select", { data: [{ id: "m-1" }] });
    expect((await accept()).error).toBeNull();
    expect(mock.writes("ncrs", "update")).toHaveLength(1);
  });

  it("lets an admin record on the client's behalf and flags it", async () => {
    testCtx.session = sessions.admin();
    const res = await accept({ decision: "rejected", comment: "Not acceptable" });
    expect(res.error).toBeNull();
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "client_rejected", changes: expect.objectContaining({ on_behalf: true }) }));
  });

  it("refuses an NCR that is still open, even for an admin", async () => {
    testCtx.session = sessions.admin();
    mock.on("ncrs", "select", { data: ncr({ status: "open" }) });
    expect((await accept()).error).toMatch(/not been worked/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("reports a concurrent close (guarded update touched no row)", async () => {
    mock.on("ncrs", "update", { data: null });
    expect((await accept()).error).toMatch(/changed meanwhile/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});
