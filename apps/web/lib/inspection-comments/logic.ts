// Pure rules for reviewer comment threads on completed inspections (no I/O, unit-tested). Mirrors
// the database guard in 20261120000100_inspection_comments.sql.

import { dedupeRecipients } from "@/lib/checklists/inspection-notify-logic";

export const MAX_COMMENT_LENGTH = 2000;
/** An author may edit their own comment for this long after posting. */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

export interface InspectionCommentRow {
  id: string;
  project_id: string;
  inspection_record_id: string;
  parent_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  users?: { full_name: string | null } | null;
}

export interface CommentThread {
  root: InspectionCommentRow;
  replies: InspectionCommentRow[];
}

/** Trimmed body, or an error message when it is empty or too long. */
export function validateCommentBody(raw: string): { body: string; error: string | null } {
  const body = raw.trim();
  if (!body) return { body, error: "Write a comment first." };
  if (body.length > MAX_COMMENT_LENGTH) return { body, error: `The comment is too long (maximum ${MAX_COMMENT_LENGTH} characters).` };
  return { body, error: null };
}

export function canEditComment(input: { authorId: string; userId: string; createdAt: string; now?: number }): boolean {
  if (input.authorId !== input.userId) return false;
  const age = (input.now ?? Date.now()) - new Date(input.createdAt).getTime();
  return Number.isFinite(age) && age <= COMMENT_EDIT_WINDOW_MS;
}

/** Only completed inspections take comments, and only while the project is writable. */
export function commentPostBlocker(input: { overallResult: string | null; projectStatus: string | null }): string | null {
  if (!input.overallResult) return "Comments can only be added to a completed inspection.";
  if (input.projectStatus === "completed" || input.projectStatus === "cancelled") {
    return "This project is completed or cancelled; comments can no longer be added.";
  }
  return null;
}

/** Top-level comments oldest first, each with its replies oldest first. Orphaned replies are dropped. */
export function groupThreads(rows: InspectionCommentRow[]): CommentThread[] {
  const byTime = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const threads = new Map<string, CommentThread>();
  for (const r of byTime) if (!r.parent_id) threads.set(r.id, { root: r, replies: [] });
  for (const r of byTime) if (r.parent_id) threads.get(r.parent_id)?.replies.push(r);
  return [...threads.values()];
}

/** Who hears about a new comment: the inspector, the signer and earlier commenters, never the author. */
export function commentRecipients(input: {
  inspectorId: string | null;
  signedByUserId?: string | null;
  priorCommenterIds: (string | null | undefined)[];
  authorId: string;
}): string[] {
  return dedupeRecipients([input.inspectorId, input.signedByUserId, ...input.priorCommenterIds], input.authorId);
}

export function commentNotification(input: { recordNumber: string; activity: string; authorName: string | null; body: string; isReply: boolean }) {
  const who = input.authorName ?? "A reviewer";
  const excerpt = input.body.length > 140 ? `${input.body.slice(0, 137)}...` : input.body;
  return {
    title: input.isReply ? "New reply on an inspection" : "New comment on an inspection",
    body: `${who} on ${input.recordNumber} (${input.activity}): ${excerpt}`,
  };
}
