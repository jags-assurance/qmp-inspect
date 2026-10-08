"use client";

import { useActionState } from "react";
import { togglePunchItemAction, type TogglePunchItemState } from "@/lib/standalone/actions";
import { Tx } from "@/components/domain/tx";

const initialState: TogglePunchItemState = { error: null };

export function PunchToggleButton({
  assignmentId,
  punchItemId,
  status,
  canClose,
}: {
  assignmentId: string;
  punchItemId: string;
  status: "open" | "closed";
  canClose: boolean;
}) {
  const [state, formAction, pending] = useActionState(togglePunchItemAction, initialState);
  // Closing needs close_punch_item authority; reopening does not.
  const blocked = status === "open" && !canClose;
  return (
    <form action={formAction} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="current_status" value={status} />
      <button
        type="submit"
        disabled={pending || blocked}
        title={blocked ? "You do not have permission to close punch items" : undefined}
        className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium hover:bg-off-white disabled:opacity-50"
      >
        <Tx>Mark</Tx> {status === "open" ? "closed" : "open"}
      </button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
