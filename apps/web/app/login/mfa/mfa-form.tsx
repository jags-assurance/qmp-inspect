"use client";

import { useActionState } from "react";
import { verifyMfaLoginAction, type MfaState } from "@/lib/auth/mfa-actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";

const initial: MfaState = { error: null };

export function MfaForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifyMfaLoginAction, initial);
  return (
    <main className="mx-auto mt-24 max-w-sm rounded-lg border border-border bg-surface p-6">
      <h1 className="text-xl font-semibold text-ink">Two-step sign-in</h1>
      <p className="mt-1 text-sm text-muted">Open your authenticator app and enter the 6-digit code for this account.</p>
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
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-lg tracking-widest outline-none focus:border-burgundy"
            aria-describedby={state.error ? "mfa-error" : undefined}
          />
          </FormField>
        </div>
        {state.error && (
          <p id="mfa-error" role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Checking…" : "Verify"}
        </Button>
      </form>
    </main>
  );
}
