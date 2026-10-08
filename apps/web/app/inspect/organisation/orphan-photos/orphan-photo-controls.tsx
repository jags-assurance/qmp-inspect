"use client";

import { useActionState, useState } from "react";
import { removeOrphanFileAction, reviewOrphanPhotoAction, type OrphanReviewState } from "@/lib/orphan-photos/actions";
import { isRemoveConfirmed, REMOVE_CONFIRMATION } from "@/lib/orphan-photos/logic";

const initial: OrphanReviewState = { error: null };
const INPUT = "rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy";

export function OrphanPhotoControls({ storagePath }: { storagePath: string }) {
  const [state, reviewAction, pending] = useActionState(reviewOrphanPhotoAction, initial);
  const [removeState, removeAction, removing] = useActionState(removeOrphanFileAction, initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <div className="mt-3 space-y-2">
      <form action={reviewAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="storage_path" value={storagePath} />
        <input name="note" maxLength={300} placeholder="Note (optional)" className={`w-56 ${INPUT}`} />
        <button type="submit" name="decision" value="kept" disabled={pending} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink hover:bg-off-white disabled:opacity-50">
          Keep
        </button>
        <button type="submit" name="decision" value="removed" disabled={pending} className="rounded-md border border-border px-3 py-1 text-xs font-medium text-ink hover:bg-off-white disabled:opacity-50">
          Mark removed
        </button>
        <button type="button" onClick={() => setConfirmOpen((v) => !v)} className="text-xs text-danger hover:underline">
          Remove file…
        </button>
      </form>

      {confirmOpen && (
        <form action={removeAction} className="rounded-md border border-danger/40 bg-danger/5 p-3">
          <input type="hidden" name="storage_path" value={storagePath} />
          <p className="text-xs text-ink">
            This permanently deletes the file from storage and cannot be undone. Type <span className="font-mono font-semibold">{REMOVE_CONFIRMATION}</span> to confirm.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Type REMOVE FILE to confirm" className={`w-40 ${INPUT}`} />
            <input name="note" maxLength={300} placeholder="Note (optional)" className={`w-56 ${INPUT}`} />
            <button
              type="submit"
              disabled={removing || !isRemoveConfirmed(typed)}
              className="rounded-md bg-danger px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {removing ? "Removing…" : "Delete file"}
            </button>
          </div>
          {removeState.error && <p role="alert" className="mt-2 text-xs text-danger">{removeState.error}</p>}
        </form>
      )}

      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {(state.success || removeState.success) && <p role="status" className="text-xs text-muted">✓ {state.success ?? removeState.success}</p>}
    </div>
  );
}
