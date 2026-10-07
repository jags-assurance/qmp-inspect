import { describe, expect, it } from "vitest";
import {
  approvePermissionStrict,
  canGenerateChecklistsForStatus,
  exitRequestError,
  isTerminalItpStatus,
  mayApproveItp,
  nextReviewRound,
  revisionApprovalRecipients,
} from "../lifecycle";
import { diffRevisions } from "../revision-diff";

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  item_number: id.toUpperCase(),
  activity: `Act ${id}`,
  acceptance_criteria: null,
  evidence_type: 1,
  discipline_id: null,
  sort_order: 0,
  ...over,
});
const section = (id: string, items: ReturnType<typeof item>[], title = `Sec ${id}`) => ({ id, section_number: 1, title, sort_order: 0, items });

describe("lifecycle rules", () => {
  it("detects terminal statuses", () => {
    expect(isTerminalItpStatus("withdrawn")).toBe(true);
    expect(isTerminalItpStatus("superseded")).toBe(true);
    expect(isTerminalItpStatus("approved")).toBe(false);
    expect(isTerminalItpStatus(null)).toBe(false);
  });
  it("allows checklist generation after approval and acceptance only", () => {
    expect(canGenerateChecklistsForStatus("approved")).toBe(true);
    expect(canGenerateChecklistsForStatus("client_accepted")).toBe(true);
    expect(canGenerateChecklistsForStatus("draft")).toBe(false);
    expect(canGenerateChecklistsForStatus("withdrawn")).toBe(false);
  });
  it("numbers review rounds", () => {
    expect(nextReviewRound(null)).toBe(1);
    expect(nextReviewRound(undefined)).toBe(1);
    expect(nextReviewRound(3)).toBe(4);
  });
  it("applies approve_itp rules", () => {
    const base = { isAdmin: false, isJagsStaff: true, hasApprovePermission: false };
    expect(mayApproveItp({ ...base, strict: false })).toBe(true);
    expect(mayApproveItp({ ...base, strict: true })).toBe(false);
    expect(mayApproveItp({ ...base, strict: true, hasApprovePermission: true })).toBe(true);
    expect(mayApproveItp({ ...base, strict: true, isAdmin: true })).toBe(true);
    expect(mayApproveItp({ isAdmin: false, isJagsStaff: false, hasApprovePermission: false, strict: false })).toBe(false);
  });
  it("reads the strict flag", () => {
    expect(approvePermissionStrict({ ITP_REQUIRE_APPROVE_PERMISSION: "1" })).toBe(true);
    expect(approvePermissionStrict({})).toBe(false);
  });
  it("validates exit requests", () => {
    expect(exitRequestError({ mode: "withdrawn", reason: "no", replacementId: "", itpId: "a" })).toMatch(/reason/);
    expect(exitRequestError({ mode: "superseded", reason: "replaced", replacementId: "", itpId: "a" })).toMatch(/replaces/);
    expect(exitRequestError({ mode: "superseded", reason: "replaced", replacementId: "a", itpId: "a" })).toMatch(/replaces/);
    expect(exitRequestError({ mode: "superseded", reason: "replaced", replacementId: "b", itpId: "a" })).toBeNull();
    expect(exitRequestError({ mode: "withdrawn", reason: "not needed", replacementId: "", itpId: "a" })).toBeNull();
  });
});

describe("revisionApprovalRecipients", () => {
  it("notifies clients, acceptor and changer once each, never the approver", () => {
    const r = revisionApprovalRecipients({ approverId: "a", changedBy: "c", clientUserIds: ["x", null, "x", "a"], assignedAcceptorId: "y" });
    expect(r).toEqual([
      { userId: "x", role: "client" },
      { userId: "y", role: "acceptor" },
      { userId: "c", role: "changer" },
    ]);
  });
  it("handles nobody to notify", () => {
    expect(revisionApprovalRecipients({ approverId: "a", changedBy: "a", clientUserIds: [] })).toEqual([]);
  });
});

describe("diffRevisions", () => {
  it("reports no change for identical snapshots", () => {
    const s = [section("s1", [item("i1")])];
    expect(diffRevisions({ sections_snapshot: s }, { sections_snapshot: s }).isEmpty).toBe(true);
  });
  it("finds added, removed and changed activities and header changes", () => {
    const older = { title: "A", sections_snapshot: [section("s1", [item("i1"), item("i2")])] };
    const newer = {
      title: "B",
      sections_snapshot: [section("s1", [item("i1", { activity: "New text", evidence_type: 3 }), item("i3")], "Renamed")],
    };
    const d = diffRevisions(older, newer);
    expect(d.headerChanges).toEqual([{ field: "title", label: "Title", before: "A", after: "B" }]);
    expect(d.addedItems.map((i) => i.id)).toEqual(["i3"]);
    expect(d.removedItems.map((i) => i.id)).toEqual(["i2"]);
    expect(d.changedItems).toHaveLength(1);
    expect(d.changedItems[0].changes.map((c) => c.label)).toEqual(["Activity", "Evidence"]);
    expect(d.changedItems[0].changes[1]).toMatchObject({ before: "Checklist", after: "Measurement" });
    expect(d.renamedSections).toHaveLength(1);
    expect(d.isEmpty).toBe(false);
  });
  it("compares sign-off levels only when both sides recorded them", () => {
    const lv = (x: string) => [{ project_party_id: "p", party_name: "Client", intervention: x }];
    const a = { sections_snapshot: [section("s", [item("i", { interventions: lv("H") })])] };
    const b = { sections_snapshot: [section("s", [item("i", { interventions: lv("W") })])] };
    expect(diffRevisions(a, b).changedItems[0].changes[0].label).toBe("Sign-off levels");
    const legacy = { sections_snapshot: [section("s", [item("i")])] };
    expect(diffRevisions(legacy, b).isEmpty).toBe(true);
  });
  it("tracks added and removed sections", () => {
    const d = diffRevisions({ sections_snapshot: [section("s1", [])] }, { sections_snapshot: [section("s2", [])] });
    expect(d.addedSections).toHaveLength(1);
    expect(d.removedSections).toHaveLength(1);
  });
});
