"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type SignInState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/domain/password-field";
import { FormMessage } from "@/components/ui/form-message";
import { FormField } from "@/components/ui/form-field";
import { useTranslate } from "@/lib/i18n/locale-context";
import { SiteLinks } from "@/components/domain/site-links";
import { AuthShell } from "@/components/domain/auth-shell";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: SignInState = { error: null };

export function LoginForm({ next, notice }: { next: string; notice?: string | null }) {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  const t = useTranslate();

  return (
    <AuthShell>
        <h1 className="text-2xl font-semibold text-ink">{t("Sign in")}</h1>
        <p className="mt-1 text-sm text-muted">{t("Use your JAGS Assurance account credentials.")}</p>

        <form onSubmit={keepValuesSubmit} className="mt-8 space-y-4" aria-busy={pending}>
          <input type="hidden" name="next" value={next} />
          <div>
            <FormField required label={t("Email")} id="email" error={state.fieldErrors?.email ? t(state.fieldErrors.email) : undefined}>
              <input
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              aria-invalid={state.error ? true : undefined}
              className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-surface px-3 py-2 text-base outline-none focus:border-burgundy focus:ring-2 focus:ring-burgundy/30 aria-[invalid=true]:border-danger sm:text-sm"
            />
            </FormField>
          </div>
          <div>
            <PasswordField id="password" name="password" label={t("Password")} autoComplete="current-password" error={state.fieldErrors?.password ? t(state.fieldErrors.password) : null} />
            <Link href="/forgot-password" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-burgundy hover:underline">
              {t("Forgot password?")}
            </Link>
          </div>

          <FormMessage
            error={t(state.error ?? notice ?? "") || null}
            suffix={state.error ? t("If you keep having trouble, use Forgot password or contact your administrator.") : undefined}
          />

          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending ? t("Signing in…") : t("Sign in")}
          </Button>
        </form>
        <SiteLinks signedIn={false} className="mt-6" />
    </AuthShell>
  );
}
