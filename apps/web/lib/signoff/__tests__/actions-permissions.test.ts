import { beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectError, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const notify = vi.hoisted(() => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => notify);

import { rejectSignoffAction, signOffAction } from "../actions";

type Mock = ReturnType<typeof resetTestCtx>;

const PROGRESS = { id: "prog-1", itp_item_id: "item-1", project_party_id: "party-1", intervention: "H", status: "pending" };
const REASON = "Spec clause 4.2 not yet satisfied";

function seed(mock: Mock, opts: { partyUserId?: string | null; partyActive?: boolean; itpStatus?: string; progress?: Record<string, unknown> } = {}) {
  mock.on("activity_signoff_progress", "select", (c) => (c.columns?.includes("project_party_id") ? { data: { ...PROGRESS, ...opts.progress } } : { data: [] }));
  mock.on("project_parties", "select", { data: { user_id: opts.partyUserId ?? "party-user", is_active: opts.partyActive ?? true, name: "Client Co", project_id: "proj-1" } });
  mock.on("itps", "select", { data: { status: opts.itpStatus ?? "approved" } });
  mock.on("itp_items", "select", (c) => (c.columns === "itp_sections(itp_id)" ? { data: { itp_sections: { itp_id: "itp-1" } } } : { data: null }));
  mock.on("activity_signoff_progress", "update", { data: [{ id: "prog-1", reject_count: 0 }] });
}

describe("signOffAction", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.external({ userId: "party-user" }));
    audit.recordAuditEvent.mockClear();
    notify.createNotification.mockClear();
    seed(mock);
  });

  it("lets the party's own linked login sign for itself (no reason needed)", async () => {
    const res = await signOffAction("prog-1");
    expect(res.error).toBeNull();
    const [update] = mock.writes("activity_signoff_progress", "update");
    expect(update.payload).toMatchObject({ status: "signed_off", signed_off_by: "party-user" });
    expect(update.filters).toContainEqual(["neq", "status", "signed_off"]);
  });

  it("lets a party team member sign when they are not the primary login", async () => {
    testCtx.session = sessions.external({ userId: "member-1" });
    mock.on("project_party_members", "select", { data: [{ id: "m-1" }] });
    expect((await signOffAction("prog-1")).error).toBeNull();
    expect(mock.writes("activity_signoff_progress", "update")).toHaveLength(1);
  });

  it("refuses an external user who is not linked to the party", async () => {
    testCtx.session = sessions.external({ userId: "stranger" });
    const res = await signOffAction("prog-1");
    expect(res.error).toMatch(/only sign off on behalf of your own party/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses a deactivated party login", async () => {
    seed(mock, { partyActive: false });
    expect((await signOffAction("prog-1")).error).toMatch(/your own party/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses an inspector who is neither admin nor a team lead", async () => {
    testCtx.session = sessions.inspector();
    const res = await signOffAction("prog-1", REASON);
    expect(res.error).toMatch(/Only an admin or team lead can sign on behalf/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets an inspector who leads a team on the project sign on behalf, with a reason", async () => {
    testCtx.session = sessions.inspector();
    mock.on("team_project_assignments", "select", { data: [{ team_id: "team-1" }] });
    mock.on("team_members", "select", { data: [{ team_id: "team-1" }] });
    expect((await signOffAction("prog-1", REASON)).error).toBeNull();
    expect(mock.writes("activity_signoff_progress", "update")).toHaveLength(1);
  });

  it("requires a written reason (10+ chars) from an admin signing on behalf", async () => {
    testCtx.session = sessions.admin();
    expect((await signOffAction("prog-1")).error).toMatch(/reason is required to sign on behalf/);
    expect((await signOffAction("prog-1", "short")).error).toMatch(/reason is required/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets an admin sign on behalf with a reason and records the on-behalf audit action", async () => {
    testCtx.session = sessions.admin();
    mock.on("itp_items", "select", (c) =>
      c.columns === "itp_sections(itp_id)"
        ? { data: { itp_sections: { itp_id: "itp-1" } } }
        : c.columns?.startsWith("activity,")
          ? { data: { activity: "Rebar", itp_sections: { itps: { itp_number: "ITP-1", project_id: "proj-1", projects: { organization_id: "org-1" } } } } }
          : { data: null }
    );
    expect((await signOffAction("prog-1", REASON)).error).toBeNull();
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "signed_off_on_behalf" }));
    expect(notify.createNotification).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientUserId: "party-user" }));
  });

  it("does not open sign-off until the ITP is approved", async () => {
    seed(mock, { itpStatus: "draft" });
    expect((await signOffAction("prog-1")).error).toMatch(/hasn't been approved/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("never overwrites an existing signature (double click)", async () => {
    mock.on("activity_signoff_progress", "update", { data: [] });
    expect((await signOffAction("prog-1")).error).toMatch(/already signed off/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects an over-long comment and an unknown record without writing", async () => {
    expect((await signOffAction("prog-1", undefined, "x".repeat(1001))).error).toMatch(/too long/);
    mock.on("activity_signoff_progress", "select", { data: null });
    expect((await signOffAction("prog-1")).error).toMatch(/not found/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("an unauthenticated caller is redirected to login and never writes", async () => {
    testCtx.session = null;
    await expect(signOffAction("prog-1")).rejects.toBeInstanceOf(RedirectError);
    expect(mock.writes()).toHaveLength(0);
  });
});

describe("rejectSignoffAction", () => {
  let mock: Mock;
  beforeEach(() => {
    mock = resetTestCtx(sessions.external({ userId: "party-user" }));
    audit.recordAuditEvent.mockClear();
    seed(mock);
  });

  it("requires a written reason before reading anything", async () => {
    const res = await rejectSignoffAction("prog-1", "no");
    expect(res.error).toMatch(/Give a reason/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses someone who is not the party, an admin or a team lead", async () => {
    testCtx.session = sessions.inspector();
    const res = await rejectSignoffAction("prog-1", REASON);
    expect(res.error).toMatch(/Only this party's own login, an admin or a team lead/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("lets the party's own login send the release back to pending", async () => {
    const res = await rejectSignoffAction("prog-1", REASON);
    expect(res.error).toBeNull();
    const [first] = mock.writes("activity_signoff_progress", "update");
    expect(first.payload).toMatchObject({ status: "pending", rejected_by: "party-user", rejection_reason: REASON });
    expect(first.filters).toContainEqual(["eq", "status", "pending"]);
  });

  it("lets an admin reject on a party's behalf", async () => {
    testCtx.session = sessions.admin();
    expect((await rejectSignoffAction("prog-1", REASON)).error).toBeNull();
    expect(mock.writes("activity_signoff_progress", "update").length).toBeGreaterThan(0);
  });

  it("refuses to reject a point that was already released", async () => {
    seed(mock, { progress: { status: "signed_off" } });
    expect((await rejectSignoffAction("prog-1", REASON)).error).toMatch(/already released/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("reports a concurrent change when the guarded update matches nothing", async () => {
    mock.on("activity_signoff_progress", "update", { data: [] });
    expect((await rejectSignoffAction("prog-1", REASON)).error).toMatch(/changed in the meantime/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});
