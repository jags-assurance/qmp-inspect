"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/helpers";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { INSPECTION_RECORDS_TABLE } from "./db-types";
import {
  parseReviewDecision,
  reviewBlocker,
  reviewStatusForDecision,
  validateReviewComment,
  type ReviewStatus,
} from "./review-logic";

export interface ReviewInspectionState {
  error: string | null;
}

/**
 * Reviewer approve / reject for a completed inspection. Additive: stores review_status,
 * reviewed_by/at and a comment on the record and does not gate completion. A rejection DOES block issuing a new IRN (issueIrnForRecord + the irns_issue_gates_guard trigger) until the inspection is re-reviewed as approved or re-opened.
 * JAGS staff only, and never the person who carried out or signed the inspection. A rejection needs
 * a reason and notifies the inspector. Re-opening the inspection clears the decision.
 */
export async function reviewInspectionAction(_prev: ReviewInspectionState, formData: FormData): Promise<ReviewInspectionState> {
  const recordId = String(formData.get("inspection_record_id") ?? "").trim();
  const decision = parseReviewDecision(String(formData.get("decision") ?? ""));
  const comment = String(formData.get("comment") ?? "").trim();
  if (!recordId) return { error: "Missing inspection record." };
  if (!decision) return { error: "Choose approve or reject." };
  const commentError = validateReviewComment(decision, comment);
  if (commentError) return { error: commentError };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: record, error: readError } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, project_id, record_number, activity, inspector_id, signed_by_user_id, overall_result, review_status")
    .eq("id", recordId)
    .maybeSingle<{
      id: string;
      project_id: string;
      record_number: string;
      activity: string;
      inspector_id: string | null;
      signed_by_user_id: string | null;
      overall_result: string | null;
      review_status: ReviewStatus | null;
    }>();
  if (readError && isMissingSchemaError(readError)) {
    return { error: "Inspection review needs a database update that has not been applied yet. Ask an admin to run the latest migrations." };
  }
  if (!record) return { error: "Inspection record not found." };

  const blocker = reviewBlocker({
    overallResult: record.overall_result,
    reviewStatus: record.review_status,
    reviewerId: session.userId,
    inspectorId: record.inspector_id,
    signedByUserId: record.signed_by_user_id,
    reviewerIsJagsStaff: session.isJagsStaff,
  });
  if (blocker) return { error: blocker };

  const status = reviewStatusForDecision(decision);
  const reviewedAt = new Date().toISOString();
  // Conditional on the record still being completed, so a concurrent re-open is never overwritten.
  const { data: updated, error } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .update({ review_status: status, reviewed_by: session.userId, reviewed_at: reviewedAt, review_comment: comment || null })
    .eq("id", record.id)
    .not("overall_result", "is", null)
    .select("id");
  if (error) {
    return { error: isMissingSchemaError(error) ? "Inspection review needs a database update that has not been applied yet." : "Could not save the review. Check you have permission and try again." };
  }
  if (!updated || updated.length === 0) return { error: "Could not save the review. The inspection may have been re-opened." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string }>();

  await recordAuditEvent(supabase, {
    organizationId: project?.organization_id ?? null,
    projectId: record.project_id,
    entityType: "inspection_record",
    entityId: record.id,
    action: status === "approved" ? "review_approved" : "review_rejected",
    actorId: session.userId,
    summary: `Inspection ${record.record_number} review ${status}${comment ? ` — ${comment}` : ""}`,
    changes: { previous_review_status: record.review_status, review_status: status },
  });

  if (status === "rejected" && record.inspector_id && project?.organization_id) {
    try {
      await createNotification(supabase, {
        organizationId: project.organization_id,
        projectId: record.project_id,
        recipientUserId: record.inspector_id,
        title: "Inspection rejected on review",
        body: `${record.record_number} (${record.activity}) was rejected by the reviewer. Reason: ${comment}`,
        link: `/inspect/inspections/${record.id}`,
      });
    } catch {
      // Best-effort.
    }
  }

  revalidatePath(`/inspect/inspections/${record.id}`);
  return { error: null };
}
