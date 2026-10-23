"use client";

import { useActionState, useState } from "react";
import {
  deactivateAllProjectPartiesAction,
  reactivateAllProjectPartiesAction,
  type BulkProjectPartiesState,
} from "@/lib/projects/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

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
  const keepValuesSubmit_reactivateAction = useKeepFormValues(reactivateState, reactivateAction);
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
            <Button
              type="submit"
              disabled={deactivatePending}
              variant="danger" size="sm"
            >
              {deactivatePending ? "Deactivating…" : "Yes, deactivate all"}
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmingDeactivate(false)}
              variant="link-muted"
            >
              <Tx>Cancel</Tx>
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            onClick={() => setConfirmingDeactivate(true)}
            variant="danger-outline" size="sm" className="w-fit"
          >
            <Tx>Deactivate all project access</Tx>
          </Button>
        )
      ) : (
        confirmingReactivate ? (
          <form onSubmit={keepValuesSubmit_reactivateAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <span className="text-sm font-medium text-ink"><Tx>Reactivate every party on this project?</Tx></span>
            <Button
              type="submit"
              disabled={reactivatePending}
              size="sm"
            >
              {reactivatePending ? "Reactivating…" : "Yes, reactivate all"}
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmingReactivate(false)}
              variant="link-muted"
            >
              <Tx>Cancel</Tx>
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            onClick={() => setConfirmingReactivate(true)}
            variant="outline" size="sm" className="w-fit"
          >
            <Tx>Reactivate all project access</Tx>
          </Button>
        )
      )}
      {deactivateState.error && <span className="text-xs text-danger">{deactivateState.error}</span>}
      {reactivateState.error && <span className="text-xs text-danger">{reactivateState.error}</span>}
    </div>
  );
}
