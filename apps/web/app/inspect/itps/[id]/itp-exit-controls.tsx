"use client";

import { useActionState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { deleteDraftItpAction, withdrawItpAction, type ItpExitState } from "@/lib/itps/lifecycle-actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";

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
  const { gateSubmit, dialog } = useConfirm();
  if (status === "superseded" || status === "withdrawn") return null;

  return (
    <div className="mt-4 flex flex-wrap items-start gap-4 text-sm">
      {status === "draft" && (
        <form
          action={deleteAction}
          onSubmit={gateSubmit({
            title: "Delete this draft ITP?",
            message: "This can't be undone.",
            confirmLabel: "Delete draft",
            destructive: true,
          })}
        >
          {dialog}
          <input type="hidden" name="itp_id" value={itpId} />
          <Button type="submit" disabled={deleting} variant="link-danger" size="sm">
            {deleting ? "Deleting…" : "Delete draft"}
          </Button>
          {deleteState.error && <p role="alert" className="mt-1 max-w-xs text-xs text-danger">{deleteState.error}</p>}
        </form>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted hover:underline"><Tx>Withdraw or supersede this ITP…</Tx></summary>
        <form action={exitAction} className="mt-2 w-80 space-y-2 rounded-md border border-border bg-surface p-3">
          <input type="hidden" name="itp_id" value={itpId} />
          <label className="block text-xs font-medium text-ink">
            <Tx>Action</Tx>
            <select name="mode" defaultValue="withdrawn" className={INPUT}>
              <option value="withdrawn"><Tx>Withdraw (no longer applies)</Tx></option>
              <option value="superseded"><Tx>Supersede (replaced by another ITP)</Tx></option>
            </select>
          </label>
          <label className="block text-xs font-medium text-ink">
            <Tx>Replaced by (when superseding)</Tx>
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
            <Tx>Reason</Tx>
            <textarea name="reason" required minLength={5} rows={2} className={INPUT} />
          </label>
          <p className="text-xs text-muted"><Tx>A withdrawn or superseded ITP becomes read-only, is kept for the record and no longer counts toward Data Book readiness.</Tx></p>
          {exitState.needsConfirm && (
            <label className="flex items-start gap-2 text-xs text-ink">
              <input type="checkbox" name="confirm_open_work" value="1" className="mt-0.5" />
              <span><Tx>I understand open inspections and NCRs stay open on a read-only ITP.</Tx></span>
            </label>
          )}
          {exitState.error && <p role="alert" className="text-xs text-danger">{exitState.error}</p>}
          <button type="submit" disabled={exiting} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink disabled:opacity-50">
            {exiting ? "Saving…" : "Confirm"}
          </button>
        </form>
      </details>
    </div>
  );
}
