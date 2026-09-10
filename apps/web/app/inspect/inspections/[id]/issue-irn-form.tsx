"use client";

import { useActionState } from "react";
import { issueIrnAction, type IssueIrnState } from "@/lib/checklists/actions";
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
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
