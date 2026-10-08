"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type SignInState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/domain/password-field";
import { FormMessage } from "@/components/ui/form-message";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";

const initialState: SignInState = { error: null };

export function LoginForm({ next, notice }: { next: string; notice?: string | null }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const t = useTranslate();

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-center bg-burgundy px-16 text-white md:flex">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold text-lg font-semibold">
          JA
        </div>
        <h1 className="mt-8 text-3xl font-semibold">JAGS Assurance</h1>
        <p className="mt-3 max-w-sm text-white/80">
          {t("Controlled quality. Assured outcomes. Sign in to the Quality Management Platform.")}
        </p>
      </div>
      <div className="flex w-full flex-col justify-center px-8 md:w-1/2 md:px-20">
        <h2 className="text-2xl font-semibold text-ink">{t("Sign in")}</h2>
        <p className="mt-1 text-sm text-muted">{t("Use your JAGS Assurance account credentials.")}</p>

        <form action={formAction} className="mt-8 space-y-4" aria-busy={pending}>
          <input type="hidden" name="next" value={next} />
          <div>
            <FormField label={t("Email")} id="email">
              <input
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              aria-invalid={state.error ? true : undefined}
              className="mt-1 min-h-11 w-full rounded-md border border-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 sm:text-sm"
            />
            </FormField>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-ink">
                {t("Password")}
              </label>
              <Link href="/forgot-password" className="text-xs font-medium text-burgundy hover:underline">
                {t("Forgot password?")}
              </Link>
            </div>
            <div className="mt-1">
              <PasswordField id="password" name="password" label="" autoComplete="current-password" />
            </div>
          </div>

          <FormMessage
            error={t(state.error ?? notice ?? "") || null}
            suffix={state.error ? t("If you keep having trouble, use Forgot password or contact your administrator.") : undefined}
          />

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? t("Signing in…") : t("Sign in")}
          </Button>
        </form>
      </div>
    </div>
  );
}
