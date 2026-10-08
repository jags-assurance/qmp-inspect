"use client";

import { useActionState } from "react";
import { gradeObservationToNcrAction, type GradeNcrState } from "@/lib/ncrs/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

export function GradeObservation({ ncrId }: { ncrId: string }) {
  const tl = useTranslate();
  const [state, action, pending] = useActionState(gradeObservationToNcrAction, { error: null } as GradeNcrState);
  return (
    <form id="grade" action={action} className="space-y-2">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <p className="text-sm text-muted">
        <Tx>Escalate this observation to a formal NCR. It gets a new due date by severity and moves to the NCR Register.</Tx>
      </p>
      <select
        name="severity"
        required
        defaultValue="minor_ncr"
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      >
        <option value="minor_ncr"><Tx>Minor NCR (due in 14 days)</Tx></option>
        <option value="major_ncr"><Tx>Major NCR (due in 7 days)</Tx></option>
      </select>
      <textarea
        name="reason"
        required
        rows={2}
        placeholder={tl("Reason for grading up (required)")}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-sm text-success"><Tx>Graded to NCR.</Tx></p>}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Grading..." : "Grade to NCR"}
      </Button>
    </form>
  );
}
