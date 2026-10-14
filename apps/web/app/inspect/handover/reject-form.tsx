"use client";

import { useActionState, useState } from "react";
import {
  rejectHandoverAction,
  reopenHandoverRejectionAction,
  type RejectHandoverState,
} from "@/lib/handover/actions";
import { MIN_REJECT_REASON_LENGTH } from "@/lib/handover/helpers";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";

const initialState: RejectHandoverState = { error: null };

/** The client's alternative to accepting: refuse the package with a reason (reject_handover()). */
export function RejectForm({ certificateId, certificateNumber }: { certificateId: string; certificateNumber: string }) {
  const [state, formAction, pending] = useActionState(rejectHandoverAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");

  if (!expanded) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
        <Tx>Reject package</Tx>
      </Button>
    );
  }

  const reasonId = `reject_reason_${certificateId}`;
  const confirmId = `reject_confirm_${certificateId}`;
  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="certificate_id" value={certificateId} />
      <p className="w-full text-xs text-muted">
        <Tx>Rejecting certificate</Tx> <span className="font-medium text-ink">{certificateNumber}</span> <Tx>tells JAGS the package is not acceptable. You cannot undo it.</Tx>
      </p>
      <div className="w-full">
        <label htmlFor={reasonId} className="block text-xs font-medium text-ink">
          <Tx>Why are you rejecting this package?</Tx>
        </label>
        <textarea
          id={reasonId}
          name="reject_reason"
          required
          minLength={MIN_REJECT_REASON_LENGTH}
          maxLength={2000}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <label htmlFor={confirmId} className="flex w-full items-start gap-2 text-sm text-ink">
        <input id={confirmId} name="confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span><Tx>I confirm I am rejecting this handover package on behalf of the client.</Tx></span>
      </label>
      <Button type="submit" size="sm" variant="primary" disabled={pending || !confirmed || reason.trim().length < MIN_REJECT_REASON_LENGTH}>
        {pending ? "Rejecting…" : "Reject package"}
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(false)} disabled={pending}>
        <Tx>Cancel</Tx>
      </Button>
      {state.error && (
        <p className="w-full text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Admin-only: clear a rejection that was made in error (reopen_handover_rejection()). */
export function ReopenRejectionForm({ certificateId }: { certificateId: string }) {
  const [state, formAction, pending] = useActionState(reopenHandoverRejectionAction, initialState);
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
        <Tx>Reopen (rejected in error)</Tx>
      </Button>
    );
  }
  const reasonId = `reopen_reason_${certificateId}`;
  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="certificate_id" value={certificateId} />
      <div className="w-full sm:w-80">
        <label htmlFor={reasonId} className="block text-xs font-medium text-ink">
          <Tx>Reason for reopening (recorded in the audit log)</Tx>
        </label>
        <input
          id={reasonId}
          name="reopen_reason"
          required
          minLength={MIN_REJECT_REASON_LENGTH}
          maxLength={1000}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Reopening…" : "Reopen"}
      </Button>
      {state.error && (
        <p className="w-full text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
