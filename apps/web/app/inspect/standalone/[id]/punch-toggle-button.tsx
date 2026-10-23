"use client";

import { useActionState } from "react";
import { togglePunchItemAction, type TogglePunchItemState } from "@/lib/standalone/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  // Closing needs close_punch_item authority; reopening does not.
  const blocked = status === "open" && !canClose;
  return (
    <form onSubmit={keepValuesSubmit} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <input type="hidden" name="punch_item_id" value={punchItemId} />
      <input type="hidden" name="current_status" value={status} />
      <Button
        type="submit"
        disabled={pending || blocked}
        title={blocked ? "You do not have permission to close punch items" : undefined}
        variant="outline" size="sm"
      >
        <Tx>Mark</Tx> {status === "open" ? "closed" : "open"}
      </Button>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
