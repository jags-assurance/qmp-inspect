"use client";

import { useActionState } from "react";
import { setEnforceHoldBlocksStartAction, type SetEnforceHoldBlocksStartState } from "@/lib/projects/actions";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: SetEnforceHoldBlocksStartState = { error: null };

export function EnforceHoldBlocksStartToggle({
  projectId,
  enforceHoldBlocksStart,
}: {
  projectId: string;
  enforceHoldBlocksStart: boolean;
}) {
  const [state, formAction, pending] = useActionState(setEnforceHoldBlocksStartAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="enforce_hold_blocks_start"
          defaultChecked={enforceHoldBlocksStart}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          disabled={pending}
        />
        <Tx>A Hold blocks starting the field inspection, not just completing it (R71)</Tx>
      </label>
      {pending && <span className="text-xs text-muted"><Tx>Saving…</Tx></span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
