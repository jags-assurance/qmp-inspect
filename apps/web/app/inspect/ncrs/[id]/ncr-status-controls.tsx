"use client";

import { useActionState, useEffect, useRef } from "react";
import { returnNcrForReworkAction, setNcrStatusAction, type NcrStatusState, type ReturnNcrState } from "@/lib/ncrs/actions";
import { RETURN_REASON_MIN } from "@/lib/ncrs/rules";
import { NEXT_STATUS, NEXT_STATUS_LABEL } from "../ncr-shared";
import type { NcrStatus } from "@/lib/ncrs/types";

const statusInitial: NcrStatusState = { error: null };
const returnInitial: ReturnNcrState = { error: null };

/**
 * Quick status button (Start progress / Send for verification) with visible error feedback.
 * Hidden unless the viewer may work the NCR, and disabled when the CAPA prerequisite for sending
 * for verification is not yet saved (same rule the server enforces).
 */
export function NcrStatusButton({
  ncrId,
  status,
  canWork,
  capaSaved,
  onDone,
}: {
  ncrId: string;
  status: NcrStatus;
  canWork: boolean;
  /** Root cause, corrective and preventive action are all saved on the NCR. */
  capaSaved: boolean;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(setNcrStatusAction, statusInitial);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state !== statusInitial && !state.error) doneRef.current?.();
  }, [state]);

  const next = NEXT_STATUS[status];
  if (!next || !canWork) return null;
  const blocked = next === "pending_verification" && !capaSaved;

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <input type="hidden" name="status" value={next} />
      <button
        type="submit"
        disabled={pending || blocked}
        className="min-h-11 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Working…" : NEXT_STATUS_LABEL[status]}
      </button>
      {blocked && <p className="max-w-xs text-end text-xs text-muted">Save root cause, corrective and preventive action first.</p>}
      {state.error && <p role="alert" className="max-w-xs text-end text-xs text-danger">{state.error}</p>}
    </form>
  );
}

/** Staff-only: return a pending-verification NCR to In progress with a mandatory reason. */
export function ReturnForReworkForm({ ncrId, onDone }: { ncrId: string; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState(returnNcrForReworkAction, returnInitial);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (state.done) doneRef.current?.();
  }, [state]);

  return (
    <form action={formAction} className="mt-4 space-y-2 border-t border-border pt-4">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <label htmlFor={`return_reason_${ncrId}`} className="block text-sm font-medium text-ink">
        Return for rework
      </label>
      <textarea
        id={`return_reason_${ncrId}`}
        name="reason"
        rows={2}
        required
        minLength={RETURN_REASON_MIN}
        placeholder={`What must be fixed before verification (at least ${RETURN_REASON_MIN} characters)`}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      />
      {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-off-white disabled:opacity-50"
      >
        {pending ? "Returning…" : "Return for rework"}
      </button>
    </form>
  );
}
