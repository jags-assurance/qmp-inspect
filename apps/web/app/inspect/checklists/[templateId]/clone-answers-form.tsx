"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { cloneLastAnswersAction, type CloneAnswersState } from "@/lib/checklists/clone-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initial: CloneAnswersState = { error: null };

/** Offered on a draft inspection: copies Yes / N/A answers from the last completed inspection of this checklist. */
export function CloneAnswersForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(async (prev: CloneAnswersState, formData: FormData) => {
    const next = await cloneLastAnswersAction(prev, formData);
    if (!next.error) router.refresh();
    return next;
  }, initial);
  const keepValuesSubmit1 = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit1} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-off-white px-3 py-2 text-sm">
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Copying…" : "Pre-fill from last inspection"}
      </Button>
      <span className="text-xs text-muted"><Tx>Copies Yes and N/A only. Check every answer.</Tx></span>
      {state.error && (
        <p role="alert" className="w-full text-xs text-danger">
          {state.error}
        </p>
      )}
      {!state.error && state.copied ? (
        <p role="status" className="w-full text-xs text-muted">
          ✓ {state.copied} <Tx>answer</Tx>{state.copied === 1 ? "" : "s"} <Tx>copied. Check them.</Tx>
        </p>
      ) : null}
    </form>
  );
}
