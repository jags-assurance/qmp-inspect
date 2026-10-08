import { beforeEach, describe, expect, it, vi } from "vitest";
import { formData, resetTestCtx, sessions, testCtx } from "@/lib/test-utils/mock-supabase";

vi.mock("@/lib/supabase/server", async () => (await import("@/lib/test-utils/mock-supabase")).serverClientModule());
vi.mock("@/lib/auth/session", async () => (await import("@/lib/test-utils/mock-supabase")).sessionModule());
vi.mock("next/cache", async () => (await import("@/lib/test-utils/mock-supabase")).nextCacheModule());
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit/log", () => audit);
const notify = vi.hoisted(() => ({ createNotification: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/helpers", () => notify);

import { editInspectionCommentAction, postInspectionCommentAction, resolveInspectionCommentAction } from "../actions";
import {
  canEditComment,
  COMMENT_EDIT_WINDOW_MS,
  commentPostBlocker,
  commentRecipients,
  groupThreads,
  validateCommentBody,
  type InspectionCommentRow,
} from "../logic";

const row = (over: Partial<InspectionCommentRow>): InspectionCommentRow => ({
  id: "c",
  project_id: "p",
  inspection_record_id: "r",
  parent_id: null,
  author_id: "u",
  body: "x",
  created_at: "2026-11-20T10:00:00Z",
  edited_at: null,
  resolved_at: null,
  resolved_by: null,
  ...over,
});

describe("comment logic", () => {
  it("validates the body", () => {
    expect(validateCommentBody("   ").error).toMatch(/Write a comment/);
    expect(validateCommentBody("a".repeat(2001)).error).toMatch(/too long/);
    expect(validateCommentBody("  ok  ")).toEqual({ body: "ok", error: null });
    expect(validateCommentBody("a".repeat(2000)).error).toBeNull();
  });
  it("allows the author to edit only inside the window", () => {
    const createdAt = "2026-11-20T10:00:00Z";
    const t = new Date(createdAt).getTime();
    expect(canEditComment({ authorId: "a", userId: "a", createdAt, now: t + COMMENT_EDIT_WINDOW_MS })).toBe(true);
    expect(canEditComment({ authorId: "a", userId: "a", createdAt, now: t + COMMENT_EDIT_WINDOW_MS + 1 })).toBe(false);
    expect(canEditComment({ authorId: "a", userId: "b", createdAt, now: t })).toBe(false);
  });
  it("only takes comments on completed inspections of writable projects", () => {
    expect(commentPostBlocker({ overallResult: null, projectStatus: "active" })).toMatch(/completed inspection/);
    expect(commentPostBlocker({ overallResult: "pass", projectStatus: "completed" })).toMatch(/completed or cancelled/);
    expect(commentPostBlocker({ overallResult: "pass", projectStatus: "cancelled" })).toMatch(/completed or cancelled/);
    expect(commentPostBlocker({ overallResult: "fail", projectStatus: "active" })).toBeNull();
  });
  it("groups replies under their root, oldest first, dropping orphans", () => {
    const threads = groupThreads([
      row({ id: "r2", parent_id: "a", created_at: "2026-11-20T10:05:00Z" }),
      row({ id: "b", created_at: "2026-11-20T10:02:00Z" }),
      row({ id: "a", created_at: "2026-11-20T10:01:00Z" }),
      row({ id: "r1", parent_id: "a", created_at: "2026-11-20T10:03:00Z" }),
      row({ id: "orphan", parent_id: "gone" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["a", "b"]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r1", "r2"]);
  });
  it("never notifies the author and dedupes", () => {
    expect(commentRecipients({ inspectorId: "i", signedByUserId: "i", priorCommenterIds: ["x", "me", "x", null], authorId: "me" })).toEqual(["i", "x"]);
    expect(commentRecipients({ inspectorId: "me", priorCommenterIds: [], authorId: "me" })).toEqual([]);
  });
});

describe("postInspectionCommentAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const post = (over: Record<string, string> = {}) =>
    postInspectionCommentAction({ error: null }, formData({ inspection_record_id: "rec-1", body: "Please re-check the torque.", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "reviewer-1" }));
    audit.recordAuditEvent.mockClear();
    notify.createNotification.mockClear();
    mock.on("inspection_records", "select", {
      data: { id: "rec-1", project_id: "proj-1", record_number: "INS-001", activity: "Weld", inspector_id: "insp-1", signed_by_user_id: "insp-1", overall_result: "pass" },
    });
    mock.on("projects", "select", { data: { organization_id: "org-1", status: "active" } });
    mock.on("inspection_comments", "select", { data: [{ author_id: "past-1" }, { author_id: "reviewer-1" }] });
    mock.on("inspection_comments", "insert", { data: [{ id: "c-1" }] });
  });

  it("validates before reading anything", async () => {
    expect((await post({ body: "  " })).error).toMatch(/Write a comment/);
    expect((await post({ inspection_record_id: "" })).error).toMatch(/Missing inspection/);
    expect(mock.calls).toHaveLength(0);
  });

  it("posts, audits and notifies the inspector and prior commenters but not the author", async () => {
    expect((await post()).error).toBeNull();
    const [insert] = mock.writes("inspection_comments", "insert");
    expect(insert.payload).toMatchObject({ project_id: "proj-1", inspection_record_id: "rec-1", parent_id: null, author_id: "reviewer-1" });
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "comment_added", entityId: "rec-1" }));
    const recipients = notify.createNotification.mock.calls.map((c) => (c as unknown as [unknown, { recipientUserId: string }])[1].recipientUserId);
    expect(recipients).toEqual(["insp-1", "past-1"]);
  });

  it("refuses an incomplete inspection and a closed project", async () => {
    mock.on("inspection_records", "select", { data: { id: "rec-1", project_id: "proj-1", record_number: "INS-001", activity: "Weld", inspector_id: null, signed_by_user_id: null, overall_result: null } });
    expect((await post()).error).toMatch(/completed inspection/);
    mock.on("inspection_records", "select", { data: { id: "rec-1", project_id: "proj-1", record_number: "INS-001", activity: "Weld", inspector_id: null, signed_by_user_id: null, overall_result: "pass" } });
    mock.on("projects", "select", { data: { organization_id: "org-1", status: "completed" } });
    expect((await post()).error).toMatch(/completed or cancelled/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("says so when the inspection is not visible", async () => {
    mock.on("inspection_records", "select", { data: null });
    expect((await post()).error).toMatch(/not found/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("only replies to a top-level comment on the same inspection", async () => {
    mock.on("inspection_comments", "select", (call) =>
      call.columns === "id, parent_id, inspection_record_id" ? { data: { id: "c-0", parent_id: "c-root", inspection_record_id: "rec-1" } } : undefined
    );
    expect((await post({ parent_id: "c-0" })).error).toMatch(/one level deep/);
    mock.on("inspection_comments", "select", (call) =>
      call.columns === "id, parent_id, inspection_record_id" ? { data: { id: "c-0", parent_id: null, inspection_record_id: "other" } } : undefined
    );
    expect((await post({ parent_id: "c-0" })).error).toMatch(/not found/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("falls back to a clear message before the migration is applied", async () => {
    mock.on("inspection_comments", "insert", { error: { code: "42P01", message: 'relation "inspection_comments" does not exist' } });
    expect((await post()).error).toMatch(/database update/);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("resolveInspectionCommentAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const resolve = (over: Record<string, string> = {}) =>
    resolveInspectionCommentAction({ error: null }, formData({ comment_id: "c-1", resolve: "true", ...over }));
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "reviewer-1" }));
    audit.recordAuditEvent.mockClear();
    mock.on("inspection_comments", "select", { data: { id: "c-1", project_id: "proj-1", inspection_record_id: "rec-1", parent_id: null, resolved_at: null } });
    mock.on("inspection_comments", "update", { data: [{ id: "c-1" }] });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
  });

  it("is staff only", async () => {
    testCtx.session = sessions.external();
    expect((await resolve()).error).toMatch(/Only JAGS staff/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("refuses to resolve a reply", async () => {
    mock.on("inspection_comments", "select", { data: { id: "c-1", project_id: "proj-1", inspection_record_id: "rec-1", parent_id: "c-0", resolved_at: null } });
    expect((await resolve()).error).toMatch(/top-level/);
    expect(mock.writes()).toHaveLength(0);
  });

  it("resolves and audits", async () => {
    expect((await resolve()).error).toBeNull();
    expect(mock.writes("inspection_comments", "update")).toHaveLength(1);
    expect(audit.recordAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "comment_resolved" }));
  });

  it("is a no-op when already in the requested state", async () => {
    expect((await resolve({ resolve: "false" })).error).toBeNull();
    expect(mock.writes()).toHaveLength(0);
  });
});

describe("editInspectionCommentAction", () => {
  let mock: ReturnType<typeof resetTestCtx>;
  const edit = () => editInspectionCommentAction({ error: null }, formData({ comment_id: "c-1", body: "Reworded" }));
  const comment = (over: Record<string, unknown> = {}) => ({
    id: "c-1",
    project_id: "proj-1",
    inspection_record_id: "rec-1",
    author_id: "reviewer-1",
    created_at: new Date().toISOString(),
    body: "Original",
    ...over,
  });
  beforeEach(() => {
    mock = resetTestCtx(sessions.inspector({ userId: "reviewer-1" }));
    audit.recordAuditEvent.mockClear();
    mock.on("inspection_comments", "update", { data: [{ id: "c-1" }] });
    mock.on("projects", "select", { data: { organization_id: "org-1" } });
  });

  it("lets the author edit inside the window", async () => {
    mock.on("inspection_comments", "select", { data: comment() });
    expect((await edit()).error).toBeNull();
    expect(mock.writes("inspection_comments", "update")[0].payload).toEqual({ body: "Reworded" });
  });

  it("refuses someone else and an expired window", async () => {
    mock.on("inspection_comments", "select", { data: comment({ author_id: "someone" }) });
    expect((await edit()).error).toMatch(/Only the author/);
    mock.on("inspection_comments", "select", { data: comment({ created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }) });
    expect((await edit()).error).toMatch(/15 minutes/);
    expect(mock.writes()).toHaveLength(0);
  });
});
