"use client";

import { useActionState } from "react";
import {
  deactivateProjectPartyAction,
  reactivateProjectPartyAction,
  type ProjectPartyActiveState,
} from "@/lib/projects/actions";

const initialState: ProjectPartyActiveState = { error: null };

/**
 * Single-party activate/reactivate control — kept alongside the bulk "deactivate/reactivate all"
 * action (deactivate-all-parties-control.tsx) so an admin can still add/reactivate one person without
 * reactivating everyone else on the project.
 */
export function ProjectPartyActiveToggle({
  projectId,
  projectPartyId,
  isActive,
}: {
  projectId: string;
  projectPartyId: string;
  isActive: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    isActive ? deactivateProjectPartyAction : reactivateProjectPartyAction,
    initialState
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="project_party_id" value={projectPartyId} />
      <button
        type="submit"
        disabled={pending}
        className={isActive ? "text-danger hover:underline disabled:opacity-50" : "text-burgundy hover:underline disabled:opacity-50"}
      >
        {pending ? "Saving…" : isActive ? "Deactivate" : "Reactivate"}
      </button>
      {state.error && <span className="text-danger">{state.error}</span>}
    </form>
  );
}
