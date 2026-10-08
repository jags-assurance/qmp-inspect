"use client";

import { useActionState } from "react";
import { issueIrnAction, voidIrnAction, type IssueIrnState } from "@/lib/checklists/actions";
import { Button } from "@/components/ui/button";

const initialState: IssueIrnState = { error: null };

export function IssueIrnForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const [state, formAction, pending] = useActionState(issueIrnAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <Button type="submit" disabled={pending}>
        {pending ? "Issuing…" : "Issue IRN"}
      </Button>
      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function VoidIrnForm({ irnId }: { irnId: string }) {
  const [state, formAction, pending] = useActionState(voidIrnAction, initialState);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-danger">Void this IRN…</summary>
      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="irn_id" value={irnId} />
        <textarea
          name="reason"
          required
          minLength={15}
          rows={2}
          placeholder="Reason for voiding (required, min 15 characters)"
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Voiding…" : "Void IRN"}
        </Button>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </form>
    </details>
  );
}
