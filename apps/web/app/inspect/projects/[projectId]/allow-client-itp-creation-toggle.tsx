"use client";

import { useActionState } from "react";
import { setAllowClientItpCreationAction, type SetAllowClientItpCreationState } from "@/lib/projects/actions";

const initialState: SetAllowClientItpCreationState = { error: null };

export function AllowClientItpCreationToggle({
  projectId,
  allowClientItpCreation,
}: {
  projectId: string;
  allowClientItpCreation: boolean;
}) {
  const [state, formAction, pending] = useActionState(setAllowClientItpCreationAction, initialState);

  return (
    <form action={formAction} className="mt-3 flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="allow_client_itp_creation"
          defaultChecked={allowClientItpCreation}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          disabled={pending}
        />
        Allow a client-type party to create and build draft ITPs on this project
      </label>
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
