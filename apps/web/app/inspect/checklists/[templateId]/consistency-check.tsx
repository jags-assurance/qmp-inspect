"use client";

import { useActionState } from "react";
import { checkChecklistConsistencyAction, type CheckConsistencyState } from "@/lib/checklists/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: CheckConsistencyState = { error: null, flags: null };

/**
 * Reqs R111: a purely advisory, button-triggered check — never runs automatically and never
 * blocks completeInspectionAction (which this component doesn't call). Same "assist never gates"
 * principle as the register soft-stop already shown on each ResponseRow.
 */
export function ConsistencyCheck({ templateId, inspectionRecordId }: { templateId: string; inspectionRecordId: string }) {
  const [state, formAction, pending] = useActionState(checkChecklistConsistencyAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink"><Tx>AI consistency check</Tx></h2>
        <Button
          type="submit"
          disabled={pending}
          variant="outline" size="sm"
        >
          {pending ? "Checking…" : "Check for inconsistencies"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted">
        <Tx>Advisory only — compares your responses against the acceptance criteria. It never blocks completing the inspection.</Tx>
      </p>

      {state.error && <p role="alert" className="mt-2 text-sm text-danger">{state.error}</p>}

      {state.flags !== null && (
        <div className="mt-3">
          {state.flags.length === 0 ? (
            <p className="text-sm text-success"><Tx>No inconsistencies flagged.</Tx></p>
          ) : (
            <ul className="list-disc space-y-1 ps-5 text-sm text-warning">
              {state.flags.map((flag, i) => (
                <li key={i}>{flag}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
