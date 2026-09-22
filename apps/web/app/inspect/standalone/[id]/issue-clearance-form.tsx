"use client";

import { useActionState, type FormEvent } from "react";
import { issueClearanceAction, type IssueClearanceState } from "@/lib/standalone/actions";
import { Button } from "@/components/ui/button";

const initialState: IssueClearanceState = { error: null };

/** R16's close-out step: turns a "conditional_open" assignment into "completed" once its linked
 *  punch item(s) are actually closed — kept as an explicit, separate action from Finalize so the
 *  clearance itself is a deliberate, recorded moment (who, when), not an automatic side-effect of
 *  the last punch item being closed. */
export function IssueClearanceForm({ assignmentId, canClear }: { assignmentId: string; canClear: boolean }) {
  const [state, formAction, pending] = useActionState(issueClearanceAction, initialState);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (!confirm("Issue clearance and mark this assignment as completed?")) {
      e.preventDefault();
    }
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <input type="hidden" name="assignment_id" value={assignmentId} />
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending || !canClear} title={!canClear ? "Close the linked punch item(s) first" : undefined}>
        {pending ? "Issuing…" : "Issue clearance"}
      </Button>
    </form>
  );
}
