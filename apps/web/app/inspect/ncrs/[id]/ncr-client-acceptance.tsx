"use client";

import { useActionState } from "react";
import {
  recordClientAcceptanceAction,
  setClientAcceptanceRequiredAction,
  type ClientAcceptanceState,
} from "@/lib/ncrs/acceptance-actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const field = "mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy";

/** Staff: toggle whether the client must accept the disposition before this NCR can be closed. */
export function ClientAcceptanceRequiredToggle({ ncrId, required }: { ncrId: string; required: boolean }) {
  const [state, action, pending] = useActionState(setClientAcceptanceRequiredAction, { error: null } as ClientAcceptanceState);
  const keepValuesSubmit1 = useKeepFormValues(state, action);
  return (
    <form onSubmit={keepValuesSubmit1} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <label className="flex items-center gap-2 text-ink">
        <input type="checkbox" name="required" defaultChecked={required} onChange={(e) => e.currentTarget.form?.requestSubmit()} disabled={pending} />
        <Tx>The client must accept the disposition before this NCR can be closed</Tx>
      </label>
      {state.error && <span className="text-xs text-danger">{state.error}</span>}
    </form>
  );
}

/** Client (or an admin on their behalf): accept or reject the recorded disposition. */
export function ClientAcceptanceForm({ ncrId }: { ncrId: string }) {
  const tl = useTranslate();
  const [state, action, pending] = useActionState(recordClientAcceptanceAction, { error: null } as ClientAcceptanceState);
  const keepValuesSubmit2 = useKeepFormValues(state, action);
  return (
    <form onSubmit={keepValuesSubmit2} className="mt-2 space-y-2">
      <input type="hidden" name="ncr_id" value={ncrId} />
      <textarea name="comment" rows={2} maxLength={1000} placeholder={tl("Comment (required if you reject)")} className={field} aria-label={tl("Comment")} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="decision"
          value="accepted"
          disabled={pending}
          
        >
          <Tx>Accept disposition</Tx>
        </Button>
        <button
          type="submit"
          name="decision"
          value="rejected"
          disabled={pending}
          className="min-h-10 rounded-md border border-border px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
        >
          <Tx>Reject disposition</Tx>
        </button>
      </div>
      {state.error && <p role="alert" className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
