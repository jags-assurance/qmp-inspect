"use client";

import { useActionState } from "react";
import { setAllowContractorItpCreationAction, type SetAllowContractorItpCreationState } from "@/lib/projects/actions";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: SetAllowContractorItpCreationState = { error: null };

export function AllowContractorItpCreationToggle({
  projectId,
  allowContractorItpCreation,
}: {
  projectId: string;
  allowContractorItpCreation: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAllowContractorItpCreationAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  return (
    <form onSubmit={keepValuesSubmit} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="allow_contractor_itp_creation"
          defaultChecked={allowContractorItpCreation}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          disabled={pending}
        />
        <Tx>Allow a subcontractor or main-contractor party to create and build draft ITPs on this project</Tx>
      </label>
      {pending && <span className="text-xs text-muted"><Tx>Saving…</Tx></span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
