"use client";

import { useActionState } from "react";
import { setAllowClientExecutionAction, type SetAllowClientExecutionState } from "@/lib/projects/actions";

const initialState: SetAllowClientExecutionState = { error: null };

export function AllowClientExecutionToggle({
  projectId,
  allowClientExecution,
}: {
  projectId: string;
  allowClientExecution: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAllowClientExecutionAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="allow_client_execution"
          defaultChecked={allowClientExecution}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          disabled={pending}
        />
        Allow client-type parties to execute checklists on this project
      </label>
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
