"use client";

import { useActionState, useState } from "react";
import {
  confirmMfaEnrolAction,
  removeMfaAction,
  startMfaEnrolAction,
  type MfaEnrolState,
  type MfaState,
} from "@/lib/auth/mfa-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initial: MfaState = { error: null };

export function SecuritySettings({ verifiedFactorId }: { verifiedFactorId: string | null }) {
  const [enrol, setEnrol] = useState<MfaEnrolState | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState(confirmMfaEnrolAction, initial);
  const [removeState, removeAction, removing] = useActionState(removeMfaAction, initial);
  const keepValuesSubmit_removeAction = useKeepFormValues(removeState, removeAction);

  async function start() {
    setStarting(true);
    setEnrol(await startMfaEnrolAction());
    setStarting(false);
  }

  if (verifiedFactorId || confirmState.success) {
    return (
      <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
        <p className="text-sm text-ink"><Tx>✓ Two-step sign-in is on for your account.</Tx></p>
        {verifiedFactorId && (
          <form onSubmit={keepValuesSubmit_removeAction} className="mt-3">
            <input type="hidden" name="factor_id" value={verifiedFactorId} />
            <Button type="submit" variant="outline" disabled={removing}>
              {removing ? "Switching off…" : "Switch off two-step sign-in"}
            </Button>
          </form>
        )}
        {removeState.error && <p role="alert" className="mt-2 text-xs text-danger">{removeState.error}</p>}
        {removeState.success && <p role="status" className="mt-2 text-xs text-muted">✓ {removeState.success}</p>}
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-4 shadow-xs sm:p-5">
      {!enrol?.factorId ? (
        <>
          <p className="text-sm text-ink"><Tx>Two-step sign-in is off.</Tx></p>
          <Button type="button" onClick={start} disabled={starting} className="mt-3">
            {starting ? "Starting…" : "Set up an authenticator app"}
          </Button>
          {enrol?.error && <p role="alert" className="mt-2 text-xs text-danger">{enrol.error}</p>}
        </>
      ) : (
        <form action={confirmAction} className="space-y-3">
          <p className="text-sm text-ink"><Tx>1. Scan this code with your authenticator app (or type the secret).</Tx></p>
          {/* A data: SVG from Supabase; next/image adds nothing for it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {enrol.qr && <img src={enrol.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded border border-border bg-white p-2" />}
          <p className="text-xs text-muted"><Tx>Secret:</Tx> <code className="doc-id select-all">{enrol.secret}</code></p>
          <input type="hidden" name="factor_id" value={enrol.factorId} />
          <label htmlFor="enrol-code" className="block text-sm text-ink"><Tx>2. Enter the 6-digit code it shows</Tx></label>
          <input
            id="enrol-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={7}
            className="w-40 rounded-md border border-border bg-surface px-3 py-2 text-lg tracking-widest outline-none focus:border-burgundy"
          />
          <div>
            <Button type="submit" disabled={confirming}>{confirming ? "Checking…" : "Turn on two-step sign-in"}</Button>
          </div>
          {confirmState.error && <p role="alert" className="text-xs text-danger">{confirmState.error}</p>}
        </form>
      )}
    </section>
  );
}
