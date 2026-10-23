"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { requestPasswordResetAction, type RequestPasswordResetState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { FormField } from "@/components/ui/form-field";
import { Tx } from "@/components/domain/tx";
import { AuthShell } from "@/components/domain/auth-shell";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: RequestPasswordResetState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);

  const sentHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.sent) sentHeading.current?.focus();
  }, [state.sent]);

  return (
    <AuthShell>
        {state.sent ? (
          <div role="status" aria-live="polite">
            <h1 ref={sentHeading} tabIndex={-1} className="text-2xl font-semibold text-ink outline-none"><Tx>Check your email</Tx></h1>
            <p className="mt-2 max-w-sm text-sm text-muted">
              <Tx>If an account exists for that address, we&apos;ve sent a link to reset your password. It expires shortly, so use it soon.</Tx>
            </p>
            <Link href="/login" className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline">
              <Tx>← Back to sign in</Tx>
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-ink"><Tx>Forgot password?</Tx></h1>
            <p className="mt-1 text-sm text-muted">
              <Tx>Enter your account email and we&apos;ll send you a link to reset it.</Tx>
            </p>

            <form onSubmit={keepValuesSubmit} className="mt-8 space-y-4">
              <div>
                <FormField required label="Email" id="email">
                  <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
                />
                </FormField>
              </div>

              <FormMessage error={state.error} />

              <Button type="submit" size="lg" disabled={pending} className="w-full">
                {pending ? "Sending…" : "Send reset link"}
              </Button>
              <Link href="/login" className="flex min-h-11 items-center justify-center text-sm font-medium text-burgundy hover:underline">
                <Tx>← Back to sign in</Tx>
              </Link>
            </form>
          </>
        )}
    </AuthShell>
  );
}
