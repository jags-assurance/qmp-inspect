"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  editInspectionCommentAction,
  postInspectionCommentAction,
  resolveInspectionCommentAction,
  type InspectionCommentState,
} from "@/lib/inspection-comments/actions";
import { canEditComment, MAX_COMMENT_LENGTH, type CommentThread, type InspectionCommentRow } from "@/lib/inspection-comments/logic";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";

const initialState: InspectionCommentState = { error: null };
const textareaClass = "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";

/** Threaded reviewer discussion on a completed inspection. The page decides whether to render it. */
export function InspectionComments({
  inspectionRecordId,
  threads,
  userId,
  isStaff,
  canPost,
}: {
  inspectionRecordId: string;
  threads: CommentThread[];
  userId: string;
  isStaff: boolean;
  /** False when the project is completed or cancelled: the thread stays readable but takes no new comments. */
  canPost: boolean;
}) {
  return (
    <div id="comments" className="mt-6 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-medium text-ink"><Tx>Comments</Tx></h2>
      {threads.length === 0 ? (
        <p className="mt-2 text-sm text-muted"><Tx>No comments yet.</Tx></p>
      ) : (
        <ul className="mt-3 space-y-4">
          {threads.map((t) => (
            <li key={t.root.id} className={`rounded-md border border-border p-3 ${t.root.resolved_at ? "bg-off-white" : ""}`}>
              <CommentBody comment={t.root} userId={userId} />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {t.root.resolved_at && <span className="text-xs font-medium text-success"><Tx>Resolved</Tx> {new Date(t.root.resolved_at).toLocaleString()}</span>}
                {isStaff && <ResolveToggle commentId={t.root.id} resolved={!!t.root.resolved_at} />}
              </div>
              {t.replies.length > 0 && (
                <ul className="mt-3 space-y-3 border-s-2 border-border ps-3">
                  {t.replies.map((r) => (
                    <li key={r.id}>
                      <CommentBody comment={r} userId={userId} />
                    </li>
                  ))}
                </ul>
              )}
              {canPost && <CommentForm inspectionRecordId={inspectionRecordId} parentId={t.root.id} label="Reply" submitLabel="Reply" rows={2} />}
            </li>
          ))}
        </ul>
      )}
      {canPost ? (
        <div className="mt-4 border-t border-border pt-3">
          <CommentForm inspectionRecordId={inspectionRecordId} parentId={null} label="Add a comment" submitLabel="Post comment" rows={3} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted"><Tx>This project is completed or cancelled, so new comments are closed.</Tx></p>
      )}
    </div>
  );
}

function CommentBody({ comment, userId }: { comment: InspectionCommentRow; userId: string }) {
  const [editing, setEditing] = useState(false);
  const mine = comment.author_id === userId;
  // The edit window is re-checked by the server and the database; this only decides whether to offer the button.
  const editable = mine && canEditComment({ authorId: comment.author_id, userId, createdAt: comment.created_at });
  return (
    <div>
      <p className="text-xs text-muted">
        <span className="font-medium text-ink">{comment.users?.full_name ?? "Unknown user"}</span> · {new Date(comment.created_at).toLocaleString()}
        {comment.edited_at ? " · edited" : ""}
      </p>
      {editing ? (
        <EditForm comment={comment} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{comment.body}</p>
          {editable && (
            <button type="button" onClick={() => setEditing(true)} className="mt-1 text-xs font-medium text-burgundy hover:underline">
              <Tx>Edit</Tx>
            </button>
          )}
        </>
      )}
    </div>
  );
}

function CommentForm({
  inspectionRecordId,
  parentId,
  label,
  submitLabel,
  rows,
}: {
  inspectionRecordId: string;
  parentId: string | null;
  label: string;
  submitLabel: string;
  rows: number;
}) {
  const [state, formAction, pending] = useActionState(postInspectionCommentAction, initialState);
  const [body, setBody] = useState("");
  const submitted = useRef(false);
  useEffect(() => {
    // Clear the box once a post has gone through without error.
    if (submitted.current && !pending && !state.error) {
      setBody("");
      submitted.current = false;
    }
  }, [pending, state.error]);
  return (
    <form action={formAction} onSubmit={() => (submitted.current = true)} className="mt-3 space-y-2">
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <FormField label={label} error={state.error}>
        <textarea name="body" rows={rows} maxLength={MAX_COMMENT_LENGTH} required value={body} onChange={(e) => setBody(e.target.value)} className={textareaClass} />
      </FormField>
      <Button type="submit" disabled={pending || body.trim().length === 0}>
        {pending ? "Posting…" : submitLabel}
      </Button>
    </form>
  );
}

function EditForm({ comment, onDone }: { comment: InspectionCommentRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(
    async (prev: InspectionCommentState, fd: FormData) => {
      const next = await editInspectionCommentAction(prev, fd);
      if (!next.error) onDone();
      return next;
    },
    initialState
  );
  const [body, setBody] = useState(comment.body);
  return (
    <form action={formAction} className="mt-1 space-y-2">
      <input type="hidden" name="comment_id" value={comment.id} />
      <FormField label="Edit comment" error={state.error} hint="You can edit a comment for 15 minutes after posting.">
        <textarea name="body" rows={3} maxLength={MAX_COMMENT_LENGTH} required value={body} onChange={(e) => setBody(e.target.value)} className={textareaClass} />
      </FormField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || body.trim().length === 0}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <button type="button" onClick={onDone} className="text-sm text-muted hover:underline">
          <Tx>Cancel</Tx>
        </button>
      </div>
    </form>
  );
}

function ResolveToggle({ commentId, resolved }: { commentId: string; resolved: boolean }) {
  const [state, formAction, pending] = useActionState(resolveInspectionCommentAction, initialState);
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="comment_id" value={commentId} />
      <input type="hidden" name="resolve" value={resolved ? "false" : "true"} />
      <button type="submit" disabled={pending} className="text-xs font-medium text-burgundy hover:underline disabled:opacity-60">
        {pending ? "Saving…" : resolved ? "Re-open thread" : "Mark resolved"}
      </button>
      {state.error && (
        <span role="alert" className="text-xs text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
