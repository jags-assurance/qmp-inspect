"use client";

import { useActionState, useState } from "react";
import { acknowledgeHandoverAction, type AcknowledgeHandoverState } from "@/lib/handover/actions";
import { Button } from "@/components/ui/button";

const initialState: AcknowledgeHandoverState = { error: null };

/** The client's own action on their handover package — see acknowledge_handover() in the migration. */
export function AcknowledgeForm({ certificateId }: { certificateId: string }) {
  const [state, formAction, pending] = useActionState(acknowledgeHandoverAction, initialState);
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)}>
        Acknowledge receipt
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="certificate_id" value={certificateId} />

      <div>
        <label className="block text-xs font-medium text-ink">Your name</label>
        <input
          name="received_by_name"
          required
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-ink">Company</label>
        <input
          name="received_by_company"
          className="mt-1 w-40 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy"
        />
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Confirming…" : "Confirm"}
      </Button>

      {state.error && <p className="w-full text-sm text-danger">{state.error}</p>}
    </form>
  );
}
