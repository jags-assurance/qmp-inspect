"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction, type RequestPasswordResetState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

const initialState: RequestPasswordResetState = { error: null, sent: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-center bg-burgundy px-16 text-white md:flex">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold text-lg font-semibold">
          JA
        </div>
        <h1 className="mt-8 text-3xl font-semibold">JAGS Assurance</h1>
        <p className="mt-3 max-w-sm text-white/80">
          Controlled quality. Assured outcomes. Sign in to the Quality Management Platform.
        </p>
      </div>
      <div className="flex w-full flex-col justify-center px-8 md:w-1/2 md:px-20">
        {state.sent ? (
          <>
            <h2 className="text-2xl font-semibold text-ink">Check your email</h2>
            <p className="mt-2 max-w-sm text-sm text-muted">
              If an account exists for that address, we&apos;ve sent a link to reset your password.
              It expires shortly, so use it soon.
            </p>
            <Link href="/login" className="mt-6 text-sm font-medium text-burgundy hover:underline">
              ← Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-ink">Forgot password?</h2>
            <p className="mt-1 text-sm text-muted">
              Enter your account email and we&apos;ll send you a link to reset it.
            </p>

            <form action={formAction} className="mt-8 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-ink">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
                />
              </div>

              {state.error && <p className="text-sm text-danger">{state.error}</p>}

              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Sending…" : "Send reset link"}
              </Button>
              <Link href="/login" className="block text-center text-sm font-medium text-burgundy hover:underline">
                ← Back to sign in
              </Link>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
