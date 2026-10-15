"use client";

import { useActionState, useState } from "react";
import { removeOrphanFileAction, reviewOrphanPhotoAction, type OrphanReviewState } from "@/lib/orphan-photos/actions";
import { isRemoveConfirmed, REMOVE_CONFIRMATION } from "@/lib/orphan-photos/logic";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

const initial: OrphanReviewState = { error: null };
const INPUT = "rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-burgundy";

export function OrphanPhotoControls({ storagePath }: { storagePath: string }) {
  const tl = useTranslate();
  const [state, reviewAction, pending] = useActionState(reviewOrphanPhotoAction, initial);
  const [removeState, removeAction, removing] = useActionState(removeOrphanFileAction, initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <div className="mt-3 space-y-2">
      <form action={reviewAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="storage_path" value={storagePath} />
        <input name="note" maxLength={300} placeholder={tl("Note (optional)")} className={`w-56 ${INPUT}`} />
        <Button type="submit" name="decision" value="kept" disabled={pending} variant="outline" size="sm">
          <Tx>Keep</Tx>
        </Button>
        <Button type="submit" name="decision" value="removed" disabled={pending} variant="outline" size="sm">
          <Tx>Mark removed</Tx>
        </Button>
        <Button type="button" onClick={() => setConfirmOpen((v) => !v)} variant="link-danger" size="sm">
          <Tx>Remove file…</Tx>
        </Button>
      </form>

      {confirmOpen && (
        <form action={removeAction} className="rounded-md border border-danger/40 bg-danger/5 p-3">
          <input type="hidden" name="storage_path" value={storagePath} />
          <p className="text-xs text-ink">
            <Tx>This permanently deletes the file from storage and cannot be undone. Type</Tx> <span className="font-mono font-semibold">{REMOVE_CONFIRMATION}</span> <Tx>to confirm.</Tx>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label={tl("Type REMOVE FILE to confirm")} className={`w-40 ${INPUT}`} />
            <input name="note" maxLength={300} placeholder={tl("Note (optional)")} className={`w-56 ${INPUT}`} />
            <Button
              type="submit"
              disabled={removing || !isRemoveConfirmed(typed)}
              variant="danger" size="sm"
            >
              {removing ? "Removing…" : "Delete file"}
            </Button>
          </div>
          {removeState.error && <p role="alert" className="mt-2 text-xs text-danger">{removeState.error}</p>}
        </form>
      )}

      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
      {(state.success || removeState.success) && <p role="status" className="text-xs text-muted">✓ {state.success ?? removeState.success}</p>}
    </div>
  );
}
