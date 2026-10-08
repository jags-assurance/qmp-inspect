// Pure rules for the reviewer approve/reject step on a completed inspection. review_status is
// additive and nullable: null means "no review recorded", and nothing else in the completion / IRN
// flow depends on it.

export type ReviewStatus = "approved" | "rejected";
export type ReviewDecision = "approve" | "reject";

export const MIN_REJECT_COMMENT_LENGTH = 10;

export function reviewStatusForDecision(decision: ReviewDecision): ReviewStatus {
  return decision === "approve" ? "approved" : "rejected";
}

export function parseReviewDecision(raw: string): ReviewDecision | null {
  return raw === "approve" || raw === "reject" ? raw : null;
}

export interface ReviewEligibilityInput {
  overallResult: string | null;
  reviewStatus: ReviewStatus | null;
  reviewerId: string;
  inspectorId: string | null;
  signedByUserId: string | null;
  reviewerIsJagsStaff: boolean;
}

/**
 * Returns an error message when this user may not review the record right now, else null.
 * Four-eyes: whoever did the inspection or signed it cannot review it.
 */
export function reviewBlocker(input: ReviewEligibilityInput): string | null {
  if (!input.reviewerIsJagsStaff) return "Only JAGS staff can review a completed inspection.";
  if (!input.overallResult) return "Only a completed inspection can be reviewed.";
  if (input.reviewStatus === "approved") return "This inspection has already been approved. Re-open it to change the outcome.";
  if (input.reviewerId === input.inspectorId || input.reviewerId === input.signedByUserId) {
    return "You carried out or signed this inspection, so someone else must review it.";
  }
  return null;
}

export function validateReviewComment(decision: ReviewDecision, comment: string): string | null {
  const trimmed = comment.trim();
  if (decision === "reject" && trimmed.length < MIN_REJECT_COMMENT_LENGTH) {
    return `Give a reason for rejecting (at least ${MIN_REJECT_COMMENT_LENGTH} characters).`;
  }
  if (trimmed.length > 2000) return "The review comment is too long (maximum 2000 characters).";
  return null;
}

export interface ReopenSnapshotInput {
  responses: ReadonlyArray<{
    checklist_item_id: string;
    result: string;
    comment: string | null;
    item_number?: string | null;
    description?: string | null;
    sort_order?: number | null;
  }>;
  inspectorSignature: string | null;
  witnessName: string | null;
  witnessSignature: string | null;
  reviewStatus: ReviewStatus | null;
}

export interface ReopenSnapshot {
  previous_responses: { checklist_item_id: string; item_number: string | null; description: string | null; result: string; comment: string | null }[];
  previous_inspector_signature: string | null;
  previous_witness_name: string | null;
  previous_witness_signature: string | null;
  previous_review_status: ReviewStatus | null;
}

/** App-side mirror of what reopen_inspection() stores (used by the non-RPC fallback path). */
export function buildReopenSnapshot(input: ReopenSnapshotInput): ReopenSnapshot {
  const ordered = [...input.responses].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return {
    previous_responses: ordered.map((r) => ({
      checklist_item_id: r.checklist_item_id,
      item_number: r.item_number ?? null,
      description: r.description ?? null,
      result: r.result,
      comment: r.comment,
    })),
    previous_inspector_signature: input.inspectorSignature,
    previous_witness_name: input.witnessName,
    previous_witness_signature: input.witnessSignature,
    previous_review_status: input.reviewStatus,
  };
}
