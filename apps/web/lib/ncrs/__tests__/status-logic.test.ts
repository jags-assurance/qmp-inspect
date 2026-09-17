// Regression tests for the fix in lib/ncrs/actions.ts (setNcrStatusAction): that action previously
// accepted ANY status value with no validation, including 'closed' — bypassing updateNcrAction's
// own CAPA-completeness gate (root cause / corrective action / verification notes required before
// closure). See resolveQuickActionStatus's doc comment in status-logic.ts for the full story.
//
// This tests the pure decision function directly rather than mocking Supabase/Next.js request
// context (this app doesn't mock its data layer — see packages/rls-tests' real-DB-fixture
// convention) — setNcrStatusAction itself is a thin wrapper: validate via this function, then write.
import { describe, expect, it } from "vitest";
import { resolveQuickActionStatus, QUICK_ACTION_STATUSES } from "../status-logic";

describe("resolveQuickActionStatus", () => {
  it("rejects a direct attempt to set status='closed' (the exact bypass this session fixed)", () => {
    expect(resolveQuickActionStatus("ncr-1", "closed")).toBeNull();
  });

  it("allows the 'in_progress' transition", () => {
    expect(resolveQuickActionStatus("ncr-1", "in_progress")).toBe("in_progress");
  });

  it("allows the 'pending_verification' transition", () => {
    expect(resolveQuickActionStatus("ncr-1", "pending_verification")).toBe("pending_verification");
  });

  it("rejects an empty/unknown status", () => {
    expect(resolveQuickActionStatus("ncr-1", "")).toBeNull();
    expect(resolveQuickActionStatus("ncr-1", "open")).toBeNull();
    expect(resolveQuickActionStatus("ncr-1", "bogus")).toBeNull();
  });

  it("rejects when the NCR id is missing, even for an otherwise-valid status", () => {
    expect(resolveQuickActionStatus("", "in_progress")).toBeNull();
  });

  it("the allow-list itself never includes 'closed'", () => {
    expect(QUICK_ACTION_STATUSES).not.toContain("closed");
    expect(QUICK_ACTION_STATUSES).toEqual(["in_progress", "pending_verification"]);
  });
});
