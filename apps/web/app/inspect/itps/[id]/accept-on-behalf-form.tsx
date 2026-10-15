"use client";

import { useActionState } from "react";
import { acceptItpOnBehalfAction, type AcceptItpState } from "@/lib/itps/actions";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";

const initialState: AcceptItpState = { error: null };

/** JAGS Admin only: accept an approved ITP on the client's behalf (needs a reference and a reason). */
export function AcceptOnBehalfForm({ itpId }: { itpId: string }) {
  const [state, formAction, pending] = useActionState(acceptItpOnBehalfAction, initialState);
  return (
    <Disclosure variant="pill" summary={<><Tx>Accept on the client&apos;s behalf</Tx></>} className="mt-3">
      <div className="mt-2 rounded-lg border border-border bg-surface p-4">
        <p className="text-xs text-muted">
          <Tx>Use this only when the client accepted outside the app (email or signed document) or has no login. It is recorded under your name with the reference and reason.</Tx>
        </p>
        <form action={formAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="itp_id" value={itpId} />
          <input type="text" name="reference" required minLength={5} placeholder="Reference, e.g. client email 12 Oct 2026 or signed form SF-123" className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
          <textarea name="reason" required minLength={10} rows={2} placeholder="Reason (why the client could not accept in the app)" className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-burgundy" />
          <Button type="submit" disabled={pending} variant="outline" className="self-start">
            {pending ? "Saving…" : "Accept on the client's behalf"}
          </Button>
        </form>
        {state.error && <p role="alert" className="mt-1 text-xs text-danger">{state.error}</p>}
      </div>
</Disclosure>
  );
}
