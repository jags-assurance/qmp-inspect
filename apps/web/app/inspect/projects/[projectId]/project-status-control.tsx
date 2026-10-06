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
export function ProjectStatusControl({
  projectId,
  status,
  openNcrs = 0,
  openPunch = 0,
}: {
  projectId: string;
  status: string;
  openNcrs?: number;
  openPunch?: number;
}) {
  const [state, formAction, pending] = useActionState(updateProjectStatusAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => {
          const next = e.currentTarget.value;
          if (next === "completed" || next === "cancelled") {
            const warnings: string[] = [];
            if (openNcrs > 0) warnings.push(`${openNcrs} open NCR${openNcrs > 1 ? "s" : ""}`);
            if (openPunch > 0) warnings.push(`${openPunch} open punch item${openPunch > 1 ? "s" : ""}`);
            const msg =
              (warnings.length ? `This project still has ${warnings.join(" and ")}. ` : "") +
              `Mark the project as ${STATUS_LABEL[next]}? ` +
              (next === "completed" ? "Make sure the Data Book has been compiled first. " : "") +
              "You can change this again later.";
            if (!window.confirm(msg)) {
              e.currentTarget.value = status;
              return;
            }
          }
          e.currentTarget.form?.requestSubmit();
        }}
        disabled={pending}
        aria-label="Project status"
        className="min-h-11 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
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
