"use client";

import { useActionState, useState } from "react";
import { returnItpToDraftAction, type ReturnItpState } from "@/lib/itps/actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

const initialState: ReturnItpState = { error: null };

/** A reviewer sends the ITP back to its preparer with a written reason (under review -> draft). */
export function ReturnItpForm({ itpId }: { itpId: string }) {
  const tl = useTranslate();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(returnItpToDraftAction, initialState);

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        variant="danger-outline"
      >
        <Tx>Return to preparer</Tx>
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <input type="hidden" name="itp_id" value={itpId} />
      <textarea
        name="reason"
        required
        minLength={5}
        rows={2}
        placeholder={tl("What needs to change? (sent to the preparer)")}
        aria-label={tl("Reason for returning the ITP")}
        className="w-full sm:min-w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
      />
      <div className="flex flex-col gap-1">
        <Button
          type="submit"
          disabled={pending}
          variant="danger-outline" size="sm"
        >
          {pending ? "Returning…" : "Confirm return"}
        </Button>
        <Button type="button" onClick={() => setOpen(false)} variant="link-muted" size="sm">
          <Tx>Cancel</Tx>
        </Button>
      </div>
      {state.error && <p role="alert" className="w-full max-w-md text-xs text-danger">{state.error}</p>}
    </form>
  );
}
