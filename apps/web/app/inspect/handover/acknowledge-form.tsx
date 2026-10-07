"use client";

import { useActionState, useState } from "react";
import { acknowledgeHandoverAction, type AcknowledgeHandoverState } from "@/lib/handover/actions";
import { Button } from "@/components/ui/button";

const initialState: AcknowledgeHandoverState = { error: null };

/** The client's own action on their handover package — see acknowledge_handover() in the migration. */
export function AcknowledgeForm({
  certificateId,
  onBehalf = false,
  userName,
}: {
  certificateId: string;
  /** True when a JAGS admin is recording the acceptance on the client's behalf. */
  onBehalf?: boolean;
  userName?: string;
}) {
  const [state, formAction, pending] = useActionState(acknowledgeHandoverAction, initialState);
  const [expanded, setExpanded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!expanded) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
        {onBehalf ? "Acknowledge on behalf of client" : "Acknowledge receipt"}
      </Button>
    );
  }

  const nameId = `ack_name_${certificateId}`;
  const companyId = `ack_company_${certificateId}`;
  const confirmId = `ack_confirm_${certificateId}`;

  return (
    <form action={formAction} className="flex w-full flex-wrap items-end gap-2">
      <input type="hidden" name="certificate_id" value={certificateId} />

      {onBehalf && (
        <p className="w-full rounded-md bg-warning/10 px-3 py-2 text-sm text-ink">
          You are recording this acceptance <strong>on behalf of the client</strong> as JAGS staff. It will be marked as such on the certificate and in the audit log.
        </p>
      )}
      <p className="w-full text-xs text-muted">
        Acknowledging as <span className="font-medium text-ink">{userName ?? "you"}</span> at the time you confirm. This is a formal acceptance of the handover package.
      </p>

      <div className="w-full sm:w-auto">
        <label htmlFor={nameId} className="block text-xs font-medium text-ink">
          {onBehalf ? "Client representative name" : "Your name"}
        </label>
        <input
          id={nameId}
          name="received_by_name"
          required
          maxLength={120}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy sm:w-40"
        />
      </div>
      <div className="w-full sm:w-auto">
        <label htmlFor={companyId} className="block text-xs font-medium text-ink">
          Company
        </label>
        <input
          id={companyId}
          name="received_by_company"
          maxLength={120}
          className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy sm:w-40"
        />
      </div>

      <label htmlFor={confirmId} className="flex w-full items-start gap-2 text-sm text-ink">
        <input id={confirmId} name="confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>
          I confirm the handover package was received and that this is a formal acceptance
          {onBehalf ? " recorded on behalf of the client" : ""}. It cannot be undone.
        </span>
      </label>

      <Button type="submit" size="sm" disabled={pending || !confirmed}>
        {pending ? "Confirming…" : "Confirm acceptance"}
      </Button>

      {state.error && (
        <p className="w-full text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
