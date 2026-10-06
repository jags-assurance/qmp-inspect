"use client";

import { useActionState } from "react";
import { gradeObservationToNcrAction, type GradeNcrState } from "@/lib/ncrs/actions";
import { Button } from "@/components/ui/button";

export function GradeObservation({ ncrId }: { ncrId: string }) {
  const [state, action, pending] = useActionState(gradeObservationToNcrAction, { error: null } as GradeNcrState);
  return (
    <form id="grade" action={action} className="space-y-2">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <p className="text-sm text-muted">
        Escalate this observation to a formal NCR. It gets a new due date by severity and moves to the NCR Register.
      </p>
      <select
        name="severity"
        required
        defaultValue="minor_ncr"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      >
        <option value="minor_ncr">Minor NCR (due in 14 days)</option>
        <option value="major_ncr">Major NCR (due in 7 days)</option>
      </select>
      <textarea
        name="reason"
        required
        rows={2}
        placeholder="Reason for grading up (required)"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-sm text-success">Graded to NCR.</p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Grading..." : "Grade to NCR"}
      </Button>
    </form>
  );
}
