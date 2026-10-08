"use client";

import { useActionState, useState } from "react";
import { reopenPunchItemAction, type ReopenPunchItemState } from "@/lib/punch-list/actions";
import { Button } from "@/components/ui/button";

const initialState: ReopenPunchItemState = { error: null };

/** Reject a fix (resolved -> open) or reopen a closed item; a reason is mandatory. */
export function ReopenPunchItemForm({
  projectId,
  punchItemId,
  label = "Reopen",
}: {
  projectId: string;
  punchItemId: string;
  label?: string;
}) {
  const [state, formAction, pending] = useActionState(reopenPunchItemAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="min-h-11 text-sm font-medium text-danger hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="project_id" value={projectId} />
      <textarea
        name="reason"
        required
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this being reopened?"
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
      />
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !reason.trim()}>
          {pending ? "Reopening…" : "Confirm reopen"}
        </Button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-off-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
