"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/helpers";
import { isMissingSchemaError } from "@/lib/offline/missing-schema";
import { INSPECTION_RECORDS_TABLE } from "@/lib/checklists/db-types";
import { INSPECTION_COMMENTS_TABLE } from "./db-types";
import { canEditComment, commentNotification, commentPostBlocker, commentRecipients, validateCommentBody } from "./logic";

export interface InspectionCommentState {
  error: string | null;
}

const NOT_APPLIED = "Inspection comments need a database update that has not been applied yet. Ask an admin to run the latest migrations.";
const SAVE_FAILED = "Could not save the comment. Check you have permission and try again.";

/** Post a top-level comment (no parent_id) or a reply (parent_id = a top-level comment) on a completed inspection. */
export async function postInspectionCommentAction(_prev: InspectionCommentState, formData: FormData): Promise<InspectionCommentState> {
  const recordId = String(formData.get("inspection_record_id") ?? "").trim();
  const parentId = String(formData.get("parent_id") ?? "").trim() || null;
  const { body, error: bodyError } = validateCommentBody(String(formData.get("body") ?? ""));
  if (!recordId) return { error: "Missing inspection record." };
  if (bodyError) return { error: bodyError };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // Read through the caller's RLS: an inspection they cannot see is "not found".
  const { data: record } = await supabase
    .from(INSPECTION_RECORDS_TABLE)
    .select("id, project_id, record_number, activity, inspector_id, signed_by_user_id, overall_result")
    .eq("id", recordId)
    .maybeSingle<{
      id: string;
      project_id: string;
      record_number: string;
      activity: string;
      inspector_id: string | null;
      signed_by_user_id: string | null;
      overall_result: string | null;
    }>();
  if (!record) return { error: "Inspection record not found." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id, status")
    .eq("id", record.project_id)
    .maybeSingle<{ organization_id: string; status: string | null }>();
  const blocker = commentPostBlocker({ overallResult: record.overall_result, projectStatus: project?.status ?? null });
  if (blocker) return { error: blocker };

  if (parentId) {
    const { data: parent, error: parentError } = await supabase
      .from(INSPECTION_COMMENTS_TABLE)
      .select("id, parent_id, inspection_record_id")
      .eq("id", parentId)
      .maybeSingle<{ id: string; parent_id: string | null; inspection_record_id: string }>();
    if (parentError && isMissingSchemaError(parentError)) return { error: NOT_APPLIED };
    if (!parent || parent.inspection_record_id !== record.id) return { error: "The comment you are replying to was not found." };
    if (parent.parent_id) return { error: "Reply to the top-level comment; threads are one level deep." };
  }

  // Earlier commenters, for notifications (a failed read just means fewer recipients).
  const { data: prior, error: priorError } = await supabase
    .from(INSPECTION_COMMENTS_TABLE)
    .select("author_id")
    .eq("inspection_record_id", record.id)
    .returns<{ author_id: string }[]>();
  if (priorError && isMissingSchemaError(priorError)) return { error: NOT_APPLIED };

  // author_id is also forced to auth.uid() by the database trigger.
  const { data: inserted, error } = await supabase
    .from(INSPECTION_COMMENTS_TABLE)
    .insert({ project_id: record.project_id, inspection_record_id: record.id, parent_id: parentId, author_id: session.userId, body })
    .select("id");
  if (error) return { error: isMissingSchemaError(error) ? NOT_APPLIED : SAVE_FAILED };
  const commentId = (inserted as unknown as { id: string }[] | null)?.[0]?.id ?? null;

  await recordAuditEvent(supabase, {
    organizationId: project?.organization_id ?? null,
    projectId: record.project_id,
    entityType: "inspection_record",
    entityId: record.id,
    action: parentId ? "comment_replied" : "comment_added",
    actorId: session.userId,
    summary: `Comment ${parentId ? "reply " : ""}added on inspection ${record.record_number}`,
    changes: { comment_id: commentId, parent_id: parentId, length: body.length },
  });

  if (project?.organization_id) {
    const recipients = commentRecipients({
      inspectorId: record.inspector_id,
      signedByUserId: record.signed_by_user_id,
      priorCommenterIds: (prior ?? []).map((p) => p.author_id),
      authorId: session.userId,
    });
    const note = commentNotification({
      recordNumber: record.record_number,
      activity: record.activity,
      authorName: session.fullName || null,
      body,
      isReply: !!parentId,
    });
    for (const recipientUserId of recipients) {
      try {
        await createNotification(supabase, {
          organizationId: project.organization_id,
          projectId: record.project_id,
          recipientUserId,
          title: note.title,
          body: note.body,
          link: `/inspect/inspections/${record.id}`,
        });
      } catch {
        // Best-effort.
      }
    }
  }

  revalidatePath(`/inspect/inspections/${record.id}`);
  return { error: null };
}

/** JAGS staff resolve / unresolve a top-level comment. */
export async function resolveInspectionCommentAction(_prev: InspectionCommentState, formData: FormData): Promise<InspectionCommentState> {
  const commentId = String(formData.get("comment_id") ?? "").trim();
  const resolve = String(formData.get("resolve") ?? "") === "true";
  if (!commentId) return { error: "Missing comment." };

  const session = await requireSession();
  if (!session.isJagsStaff) return { error: "Only JAGS staff can resolve a comment." };
  const supabase = await createSupabaseServerClient();

  const { data: comment, error: readError } = await supabase
    .from(INSPECTION_COMMENTS_TABLE)
    .select("id, project_id, inspection_record_id, parent_id, resolved_at")
    .eq("id", commentId)
    .maybeSingle<{ id: string; project_id: string; inspection_record_id: string; parent_id: string | null; resolved_at: string | null }>();
  if (readError && isMissingSchemaError(readError)) return { error: NOT_APPLIED };
  if (!comment) return { error: "Comment not found." };
  if (comment.parent_id) return { error: "Only a top-level comment can be resolved." };
  if ((comment.resolved_at !== null) === resolve) return { error: null };

  // The database trigger stamps resolved_at / resolved_by itself; the values here only mark the direction.
  const { data: updated, error } = await supabase
    .from(INSPECTION_COMMENTS_TABLE)
    .update(resolve ? { resolved_at: new Date().toISOString(), resolved_by: session.userId } : { resolved_at: null, resolved_by: null })
    .eq("id", comment.id)
    .select("id");
  if (error) return { error: isMissingSchemaError(error) ? NOT_APPLIED : "Could not update the comment. Check you have permission and try again." };
  if (!updated || updated.length === 0) return { error: "Could not update the comment." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", comment.project_id)
    .maybeSingle<{ organization_id: string }>();
  await recordAuditEvent(supabase, {
    organizationId: project?.organization_id ?? null,
    projectId: comment.project_id,
    entityType: "inspection_record",
    entityId: comment.inspection_record_id,
    action: resolve ? "comment_resolved" : "comment_unresolved",
    actorId: session.userId,
    summary: `Comment thread ${resolve ? "resolved" : "re-opened"} on an inspection`,
    changes: { comment_id: comment.id },
  });

  revalidatePath(`/inspect/inspections/${comment.inspection_record_id}`);
  return { error: null };
}

/** The author edits their own comment within the edit window. */
export async function editInspectionCommentAction(_prev: InspectionCommentState, formData: FormData): Promise<InspectionCommentState> {
  const commentId = String(formData.get("comment_id") ?? "").trim();
  const { body, error: bodyError } = validateCommentBody(String(formData.get("body") ?? ""));
  if (!commentId) return { error: "Missing comment." };
  if (bodyError) return { error: bodyError };

  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: comment, error: readError } = await supabase
    .from(INSPECTION_COMMENTS_TABLE)
    .select("id, project_id, inspection_record_id, author_id, created_at, body")
    .eq("id", commentId)
    .maybeSingle<{ id: string; project_id: string; inspection_record_id: string; author_id: string; created_at: string; body: string }>();
  if (readError && isMissingSchemaError(readError)) return { error: NOT_APPLIED };
  if (!comment) return { error: "Comment not found." };
  if (comment.author_id !== session.userId) return { error: "Only the author can edit a comment." };
  if (!canEditComment({ authorId: comment.author_id, userId: session.userId, createdAt: comment.created_at })) {
    return { error: "A comment can only be edited within 15 minutes of posting." };
  }
  if (comment.body === body) return { error: null };

  const { data: updated, error } = await supabase
    .from(INSPECTION_COMMENTS_TABLE)
    .update({ body })
    .eq("id", comment.id)
    .eq("author_id", session.userId)
    .select("id");
  if (error) return { error: isMissingSchemaError(error) ? NOT_APPLIED : "Could not save the edit. The 15-minute edit window may have passed." };
  if (!updated || updated.length === 0) return { error: "Could not save the edit." };

  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", comment.project_id)
    .maybeSingle<{ organization_id: string }>();
  await recordAuditEvent(supabase, {
    organizationId: project?.organization_id ?? null,
    projectId: comment.project_id,
    entityType: "inspection_record",
    entityId: comment.inspection_record_id,
    action: "comment_edited",
    actorId: session.userId,
    summary: "Comment edited on an inspection",
    changes: { comment_id: comment.id },
  });

  revalidatePath(`/inspect/inspections/${comment.inspection_record_id}`);
  return { error: null };
}
