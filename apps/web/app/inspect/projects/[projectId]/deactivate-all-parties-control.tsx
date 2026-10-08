"use client";

import { useActionState, useState } from "react";
import {
  deactivateAllProjectPartiesAction,
  reactivateAllProjectPartiesAction,
  type BulkProjectPartiesState,
} from "@/lib/projects/actions";
import { Tx } from "@/components/domain/tx";

const initialState: BulkProjectPartiesState = { error: null };

/**
 * The "project's done, no need people" bulk action from the CEO ask — deliberately NOT wired to the
 * project status dropdown (a status can be flipped to completed/cancelled by mistake or briefly, and
 * silently dropping everyone's access on that alone is exactly the failure mode to avoid). Instead
 * this is its own explicit button, shown only when the project's status already is completed/
 * cancelled, with a plain inline "are you sure" step (second click) rather than a modal.
 */
export function DeactivateAllPartiesControl({
  projectId,
  hasActiveParties,
}: {
  projectId: string;
  hasActiveParties: boolean;
}) {
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateAllProjectPartiesAction,
    initialState
  );
  const [reactivateState, reactivateAction, reactivatePending] = useActionState(
    reactivateAllProjectPartiesAction,
    initialState
  );
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [confirmingReactivate, setConfirmingReactivate] = useState(false);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {hasActiveParties ? (
        confirmingDeactivate ? (
          <form action={deactivateAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <span className="text-sm font-medium text-danger">
              <Tx>Deactivate every currently-active party&apos;s access on this project?</Tx>
            </span>
            <button
              type="submit"
              disabled={deactivatePending}
              className="rounded-md bg-danger px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {deactivatePending ? "Deactivating…" : "Yes, deactivate all"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(false)}
              className="text-sm text-muted hover:underline"
            >
              <Tx>Cancel</Tx>
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDeactivate(true)}
            className="w-fit rounded-md border border-danger px-3 py-1.5 text-sm text-danger hover:bg-danger/5"
          >
            <Tx>Deactivate all project access</Tx>
          </button>
        )
      ) : (
        confirmingReactivate ? (
          <form action={reactivateAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <span className="text-sm font-medium text-ink"><Tx>Reactivate every party on this project?</Tx></span>
            <button
              type="submit"
              disabled={reactivatePending}
              className="rounded-md bg-burgundy px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {reactivatePending ? "Reactivating…" : "Yes, reactivate all"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingReactivate(false)}
              className="text-sm text-muted hover:underline"
            >
              <Tx>Cancel</Tx>
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingReactivate(true)}
            className="w-fit rounded-md border border-burgundy px-3 py-1.5 text-sm text-burgundy hover:bg-burgundy/5"
          >
            <Tx>Reactivate all project access</Tx>
          </button>
        )
      )}
      {deactivateState.error && <span className="text-xs text-danger">{deactivateState.error}</span>}
      {reactivateState.error && <span className="text-xs text-danger">{reactivateState.error}</span>}
    </div>
  );
}
