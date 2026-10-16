"use client";

import { useActionState } from "react";
import { issueIrnAction, voidIrnAction, type IssueIrnState } from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { NextNumberHint } from "@/components/domain/next-number-hint";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Disclosure } from "@/components/ui/disclosure";

const initialState: IssueIrnState = { error: null };

export function IssueIrnForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const [state, formAction, pending] = useActionState(issueIrnAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Issuing…" : "Issue IRN"}
      </Button>
      <NextNumberHint kind="irn" id={inspectionRecordId} />
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function VoidIrnForm({ irnId }: { irnId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(voidIrnAction, initialState);
  return (
    <Disclosure variant="inline" summary={<><Tx>Void this IRN…</Tx></>} className="mt-3 text-sm">
      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="irn_id" value={irnId} />
        <textarea aria-label={tl("Reason for voiding (required, min 15 characters)")}
          name="reason"
          required
          minLength={15}
          rows={2}
          placeholder={tl("Reason for voiding (required, min 15 characters)")}
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Voiding…" : "Void IRN"}
        </Button>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </form>
</Disclosure>
  );
}
