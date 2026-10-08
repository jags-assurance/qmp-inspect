import { describe, expect, it } from "vitest";
import {
  buildReopenSnapshot,
  parseReviewDecision,
  reviewBlocker,
  reviewStatusForDecision,
  validateReviewComment,
  type ReviewEligibilityInput,
} from "../review-logic";

const base: ReviewEligibilityInput = {
  overallResult: "pass",
  reviewStatus: null,
  reviewerId: "reviewer",
  inspectorId: "inspector",
  signedByUserId: "inspector",
  reviewerIsJagsStaff: true,
};

describe("parseReviewDecision / reviewStatusForDecision", () => {
  it("accepts only approve|reject", () => {
    expect(parseReviewDecision("approve")).toBe("approve");
    expect(parseReviewDecision("reject")).toBe("reject");
    expect(parseReviewDecision("maybe")).toBeNull();
    expect(reviewStatusForDecision("approve")).toBe("approved");
    expect(reviewStatusForDecision("reject")).toBe("rejected");
  });
});

describe("reviewBlocker", () => {
  it("allows a staff reviewer on a completed, unreviewed record", () => {
    expect(reviewBlocker(base)).toBeNull();
  });
  it("allows re-reviewing a rejected record", () => {
    expect(reviewBlocker({ ...base, reviewStatus: "rejected" })).toBeNull();
  });
  it("blocks non-staff, incomplete, already-approved and self-review", () => {
    expect(reviewBlocker({ ...base, reviewerIsJagsStaff: false })).toMatch(/JAGS staff/);
    expect(reviewBlocker({ ...base, overallResult: null })).toMatch(/completed/);
    expect(reviewBlocker({ ...base, reviewStatus: "approved" })).toMatch(/already been approved/);
    expect(reviewBlocker({ ...base, reviewerId: "inspector" })).toMatch(/someone else/);
    expect(reviewBlocker({ ...base, inspectorId: null, signedByUserId: "reviewer" })).toMatch(/someone else/);
  });
});

describe("validateReviewComment", () => {
  it("requires a real reason only for a rejection", () => {
    expect(validateReviewComment("approve", "")).toBeNull();
    expect(validateReviewComment("reject", "short")).toMatch(/at least 10/);
    expect(validateReviewComment("reject", "Photos do not show the weld")).toBeNull();
    expect(validateReviewComment("approve", "x".repeat(2001))).toMatch(/too long/);
  });
});

describe("buildReopenSnapshot", () => {
  it("keeps answers in item order plus signatures and the prior review status", () => {
    const snap = buildReopenSnapshot({
      responses: [
        { checklist_item_id: "b", result: "no", comment: "bad", item_number: "2", description: "Second", sort_order: 1 },
        { checklist_item_id: "a", result: "yes", comment: null, item_number: "1", description: "First", sort_order: 0 },
      ],
      inspectorSignature: "data:image/png;base64,AAA",
      witnessName: "W",
      witnessSignature: "data:image/png;base64,BBB",
      reviewStatus: "approved",
    });
    expect(snap.previous_responses.map((r) => r.checklist_item_id)).toEqual(["a", "b"]);
    expect(snap.previous_responses[1]).toMatchObject({ result: "no", comment: "bad", item_number: "2" });
    expect(snap.previous_inspector_signature).toBe("data:image/png;base64,AAA");
    expect(snap.previous_witness_name).toBe("W");
    expect(snap.previous_review_status).toBe("approved");
  });
  it("handles missing item metadata", () => {
    const snap = buildReopenSnapshot({
      responses: [{ checklist_item_id: "x", result: "na", comment: null }],
      inspectorSignature: null,
      witnessName: null,
      witnessSignature: null,
      reviewStatus: null,
    });
    expect(snap.previous_responses[0]).toEqual({ checklist_item_id: "x", item_number: null, description: null, result: "na", comment: null });
  });
});
