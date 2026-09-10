"use client";

import { useActionState } from "react";
import { issueHandoverAction, type IssueHandoverState } from "@/lib/handover/actions";
import { Button } from "@/components/ui/button";

const initialState: IssueHandoverState = { error: null };

export function IssueHandoverForm({ projectId, dataBookId }: { projectId: string; dataBookId: string }) {
  const [state, formAction, pending] = useActionState(issueHandoverAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="data_book_id" value={dataBookId} />
      <input type="hidden" name="project_id" value={projectId} />

      <div>
        <label htmlFor={`certificate_number_${dataBookId}`} className="block text-xs font-medium text-ink">
          Certificate number
        </label>
        <input
          id={`certificate_number_${dataBookId}`}
          name="certificate_number"
          required
          placeholder="e.g. HC-001"
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Issuing…" : "Issue for handover"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
