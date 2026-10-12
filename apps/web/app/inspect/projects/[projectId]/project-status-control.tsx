"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  updateProjectStatusAction,
  getProjectCloseSummaryAction,
  type UpdateProjectStatusState,
  type ProjectCloseSummary,
} from "@/lib/projects/actions";
import { isClosedStatus } from "@/lib/projects/close-helpers";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

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
 * Admin-only status dropdown. Moving to Completed goes through the close_project() RPC (which blocks
 * on open NCRs / punch items / draft inspections unless a reason is given); the confirm panel lists
 * those counts first. Leaving Completed/Cancelled requires a reason, which is audit-logged with
 * from/to and notifies the client users on re-open. Deliberately doesn't auto-trigger
 * DeactivateAllPartiesControl — that stays its own explicit click.
 *
 * openNcrs / openPunch props are kept for caller compatibility; the panel loads full live counts itself.
 */
export function ProjectStatusControl({
  projectId,
  status,
}: {
  projectId: string;
  status: string;
  openNcrs?: number;
  openPunch?: number;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(updateProjectStatusAction, initialState);
  const [target, setTarget] = useState<string | null>(null);
  const [summary, setSummary] = useState<ProjectCloseSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [reason, setReason] = useState("");
  const [autoSubmit, setAutoSubmit] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // A status change landed (server revalidated with a new status): close the panel.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
    setTarget(null);
    setSummary(null);
    setReason("");
  }, [status]);

  useEffect(() => {
    if (autoSubmit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-mount / external-event sync (hydration-safe default, then real value); not derivable during render
      setAutoSubmit(false);
      formRef.current?.requestSubmit();
    }
  }, [autoSubmit]);

  const leavingClosed = isClosedStatus(status) && target !== null && target !== status;
  const closing = target === "completed" || target === "cancelled";
  // Putting a project on hold stops its field work, so it is confirmed too rather than saved on select.
  const pausing = target === "on_hold";
  const needsPanel = target !== null && target !== status && (closing || leavingClosed || pausing);
  const blockers = summary?.blockers ?? [];

  async function onChange(next: string) {
    if (next === status) {
      setTarget(null);
      return;
    }
    setTarget(next);
    setReason("");
    if (next === "completed" || next === "cancelled") {
      setLoadingSummary(true);
      setSummary(await getProjectCloseSummaryAction(projectId).catch(() => null));
      setLoadingSummary(false);
    } else if (!isClosedStatus(status) && next !== "on_hold") {
      setAutoSubmit(true);
    }
  }

  function cancel() {
    setTarget(null);
    setSummary(null);
    setReason("");
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="status" value={target ?? status} />
      <input type="hidden" name="reason" value={reason} />
      <div className="flex items-center gap-2">
        <select
          value={target ?? status}
          onChange={(e) => void onChange(e.currentTarget.value)}
          disabled={pending}
          aria-label={tl("Project status")}
          className="min-h-11 rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
        {pending && <span className="text-xs text-muted"><Tx>Saving…</Tx></span>}
      </div>

      {needsPanel && (
        <div role="alertdialog" aria-label={tl("Confirm project status change")} className="max-w-md rounded-md border border-border bg-surface p-3 text-sm text-ink shadow-sm">
          <p className="font-medium">
            <Tx>Change status from</Tx> {STATUS_LABEL[status] ?? status} <Tx>to</Tx> {STATUS_LABEL[target ?? ""] ?? target}?
          </p>
          {closing && loadingSummary && <p className="mt-1 text-xs text-muted"><Tx>Checking open items…</Tx></p>}
          {closing && !loadingSummary && (
            <div className="mt-1 text-xs">
              {blockers.length > 0 ? (
                <>
                  <p className="text-danger"><Tx>This project still has outstanding work:</Tx></p>
                  <ul className="mt-1 list-disc ps-5">
                    {summary && summary.openNcrs > 0 && <li>{summary.openNcrs} <Tx>open NCR</Tx>{summary.openNcrs === 1 ? "" : "s"}</li>}
                    {summary && summary.openPunch > 0 && <li>{summary.openPunch} <Tx>open punch item</Tx>{summary.openPunch === 1 ? "" : "s"}</li>}
                    {summary && summary.overdueHolds > 0 && <li>{summary.overdueHolds} <Tx>overdue hold point</Tx>{summary.overdueHolds === 1 ? "" : "s"}</li>}
                    {summary && summary.draftInspections > 0 && <li>{summary.draftInspections} <Tx>draft inspection</Tx>{summary.draftInspections === 1 ? "" : "s"}</li>}
                  </ul>
                  <p className="mt-1 text-muted"><Tx>A reason is required to close with these outstanding.</Tx></p>
                </>
              ) : (
                <p className="text-muted"><Tx>No open NCRs, punch items, overdue holds or draft inspections.</Tx></p>
              )}
              {target === "completed" && <p className="mt-1 text-muted"><Tx>Make sure the Data Book has been compiled first. Closing blocks further edits by non-admins.</Tx></p>}
            </div>
          )}
          {leavingClosed && <p className="mt-1 text-xs text-muted"><Tx>Re-opening notifies the client and the responsible person. A reason is required.</Tx></p>}

          {(leavingClosed || (closing && blockers.length > 0)) && (
            <div className="mt-2">
              <label htmlFor={`status-reason-${projectId}`} className="block text-xs font-medium">
                <Tx>Reason</Tx>
              </label>
              <textarea
                id={`status-reason-${projectId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={1000}
                className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
              />
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="submit"
              disabled={pending || loadingSummary || ((leavingClosed || blockers.length > 0) && reason.trim().length < 5)}
              className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <Tx>Confirm</Tx>
            </button>
            <button type="button" onClick={cancel} disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-sm">
              <Tx>Cancel</Tx>
            </button>
          </div>
        </div>
      )}

      {state.error && (
        <span className="text-xs text-danger" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
