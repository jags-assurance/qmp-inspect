"use client";

import { useActionState } from "react";
import { deleteDraftItpAction, withdrawItpAction, type ItpExitState } from "@/lib/itps/lifecycle-actions";

const initialState: ItpExitState = { error: null };
const INPUT = "mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-burgundy";

/** Withdraw / supersede an issued ITP, or delete a never-submitted draft. JAGS staff. */
export function ItpExitControls({
  itpId,
  status,
  siblingItps,
}: {
  itpId: string;
  status: string;
  siblingItps: { id: string; itp_number: string }[];
}) {
  const [exitState, exitAction, exiting] = useActionState(withdrawItpAction, initialState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteDraftItpAction, initialState);
  if (status === "superseded" || status === "withdrawn") return null;

  return (
    <div className="mt-4 flex flex-wrap items-start gap-4 text-sm">
      {status === "draft" && (
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (!confirm("Delete this draft ITP? This can't be undone.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="itp_id" value={itpId} />
          <button type="submit" disabled={deleting} className="text-xs text-danger hover:underline disabled:opacity-50">
            {deleting ? "Deleting…" : "Delete draft"}
          </button>
          {deleteState.error && <p className="mt-1 max-w-xs text-xs text-danger">{deleteState.error}</p>}
        </form>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted hover:underline">Withdraw or supersede this ITP…</summary>
        <form action={exitAction} className="mt-2 w-80 space-y-2 rounded-md border border-border bg-surface p-3">
          <input type="hidden" name="itp_id" value={itpId} />
          <label className="block text-xs font-medium text-ink">
            Action
            <select name="mode" defaultValue="withdrawn" className={INPUT}>
              <option value="withdrawn">Withdraw (no longer applies)</option>
              <option value="superseded">Supersede (replaced by another ITP)</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-ink">
            Replaced by (when superseding)
            <select name="superseded_by_itp_id" defaultValue="" className={INPUT}>
              <option value="">—</option>
              {siblingItps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.itp_number}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-ink">
            Reason
            <textarea name="reason" required minLength={5} rows={2} className={INPUT} />
          </label>
          <p className="text-xs text-muted">A withdrawn or superseded ITP becomes read-only, is kept for the record and no longer counts toward Data Book readiness.</p>
          {exitState.error && <p className="text-xs text-danger">{exitState.error}</p>}
          <button type="submit" disabled={exiting} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink disabled:opacity-50">
            {exiting ? "Saving…" : "Confirm"}
          </button>
        </form>
      </details>
    </div>
  );
}
