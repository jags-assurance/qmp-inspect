"use client";

import { useActionState } from "react";
import { reopenInspectionAction, type ReopenInspectionState } from "@/lib/checklists/lifecycle-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Disclosure } from "@/components/ui/disclosure";

const initialState: ReopenInspectionState = { error: null };

export function ReopenInspectionForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(reopenInspectionAction, initialState);
  return (
    <Disclosure variant="inline" summary={<><Tx>Re-open inspection…</Tx></>} className="text-sm">
      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
        <p className="text-xs text-muted">
          <Tx>Clears the result and signatures so the inspection can be corrected, and voids any issued IRN. The original signed result is kept in the amendment history.</Tx>
        </p>
        <textarea
          name="reason"
          required
          minLength={15}
          rows={2}
          placeholder={tl("Reason for re-opening (required, min 15 characters)")}
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Re-opening…" : "Re-open inspection"}
        </Button>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </form>
</Disclosure>
  );
}
