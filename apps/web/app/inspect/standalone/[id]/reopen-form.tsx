"use client";

import { useActionState } from "react";
import { reopenAssignmentAction, type ReopenAssignmentState } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: ReopenAssignmentState = { error: null };

/** Admin-only: returns a completed (e.g. failed) assignment to draft with a recorded reason. */
export function ReopenForm({ assignmentId }: { assignmentId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(reopenAssignmentAction, initialState);
  const { gateSubmit, dialog } = useConfirm();
  return (
    <form
      action={formAction}
      onSubmit={gateSubmit({
        title: "Reopen this assignment?",
        message: "It returns to draft and its conclusion will be cleared.",
        confirmLabel: "Reopen",
      })}
      className="mt-4 space-y-2 rounded-lg border border-border bg-surface p-4"
    >
      {dialog}
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <label htmlFor="reopen_reason" className="block text-sm font-medium text-ink">
        <Tx>Reopen with reason (admin only)</Tx>
      </label>
      <textarea
        id="reopen_reason"
        name="reason"
        required
        minLength={10}
        maxLength={2000}
        rows={2}
        placeholder={tl("Why is this being reopened (e.g. re-test after repair)?")}
        className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
      />
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Reopening…" : "Reopen with reason"}
      </Button>
    </form>
  );
}
