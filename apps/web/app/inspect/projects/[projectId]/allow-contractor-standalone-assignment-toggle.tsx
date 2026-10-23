"use client";

import { useActionState } from "react";
import {
  setAllowContractorStandaloneAssignmentAction,
  type SetAllowContractorStandaloneAssignmentState,
} from "@/lib/projects/actions";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: SetAllowContractorStandaloneAssignmentState = { error: null };

export function AllowContractorStandaloneAssignmentToggle({
  projectId,
  allowContractorStandaloneAssignment,
}: {
  projectId: string;
  allowContractorStandaloneAssignment: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAllowContractorStandaloneAssignmentAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="allow_contractor_standalone_assignment"
          defaultChecked={allowContractorStandaloneAssignment}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          disabled={pending}
        />
        <Tx>Allow a subcontractor or main-contractor party to run Standalone Assignments (FAT/witness/test/pre-shipment) on this project</Tx>
      </label>
      {pending && <span className="text-xs text-muted"><Tx>Saving…</Tx></span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
