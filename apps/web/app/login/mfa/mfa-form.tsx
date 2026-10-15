"use client";

import { useActionState } from "react";
import { verifyMfaLoginAction, type MfaState } from "@/lib/auth/mfa-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";

const initial: MfaState = { error: null };

export function MfaForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifyMfaLoginAction, initial);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-xs sm:p-8">
      <h1 className="text-xl font-semibold text-ink"><Tx>Two-step sign-in</Tx></h1>
      <p className="mt-1 text-sm text-muted"><Tx>Open your authenticator app and enter the 6-digit code for this account.</Tx></p>
      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="next" value={next} />
        <div>
          <FormField label="Code" id="mfa-code">
            <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={7}
            aria-invalid={state.error ? true : undefined}
            className="mt-1 min-h-12 w-full rounded-md border border-border bg-surface px-3 py-2 text-center text-xl tracking-widest outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 aria-[invalid=true]:border-danger"
            aria-describedby={state.error ? "mfa-error" : undefined}
          />
          </FormField>
        </div>
        {state.error && (
          <p id="mfa-error" role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
            {state.error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Checking…" : "Verify"}
        </Button>
      </form>
      </div>
    </main>
  );
}
