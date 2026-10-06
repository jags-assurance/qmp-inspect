"use client";

import { useActionState } from "react";
import { reopenInspectionAction, type ReopenInspectionState } from "@/lib/checklists/lifecycle-actions";
import { Button } from "@/components/ui/button";

const initialState: ReopenInspectionState = { error: null };

export function ReopenInspectionForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const [state, formAction, pending] = useActionState(reopenInspectionAction, initialState);
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium text-burgundy">Re-open inspection…</summary>
      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
        <p className="text-xs text-muted">
          Clears the result and signatures so the inspection can be corrected, and voids any issued IRN. The original signed
          result is kept in the amendment history.
        </p>
        <textarea
          name="reason"
          required
          minLength={15}
          rows={2}
          placeholder="Reason for re-opening (required, min 15 characters)"
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Re-opening…" : "Re-open inspection"}
        </Button>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
      </form>
    </details>
  );
}
