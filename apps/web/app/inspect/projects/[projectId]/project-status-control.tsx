"use client";

import { useActionState } from "react";
import { updateProjectStatusAction, type UpdateProjectStatusState } from "@/lib/projects/actions";

const initialState: UpdateProjectStatusState = { error: null };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUSES = ["draft", "active", "on_hold", "completed", "cancelled"];

/**
 * Admin-only status dropdown — see updateProjectStatusAction's own comment for why this didn't
 * exist until now. Submits on change, same "no separate save button" pattern as the other toggles
 * on this page (e.g. EnforceHoldBlocksStartToggle). Deliberately doesn't auto-trigger
 * DeactivateAllPartiesControl on "completed"/"cancelled" — that stays its own explicit click.
 */
export function ProjectStatusControl({ projectId, status }: { projectId: string; status: string }) {
  const [state, formAction, pending] = useActionState(updateProjectStatusAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        disabled={pending}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s] ?? s}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted">Saving…</span>}
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}
