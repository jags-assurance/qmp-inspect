"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

const initialState: SignInState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

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
        <h2 className="text-2xl font-semibold text-ink">Sign in</h2>
        <p className="mt-1 text-sm text-muted">Use your JAGS Assurance account credentials.</p>

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
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-burgundy"
            />
          </div>

          {state.error && <p className="text-sm text-danger">{state.error}</p>}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
