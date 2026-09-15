"use client";

import { useActionState, useState } from "react";
import { updatePasswordAction, type UpdatePasswordState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/domain/password-field";

const initialState: UpdatePasswordState = { error: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
        <h2 className="text-2xl font-semibold text-ink">Set a new password</h2>
        <p className="mt-1 text-sm text-muted">Choose a new password for your account.</p>

        <form action={formAction} className="mt-8 space-y-4">
          <PasswordField
            id="password"
            name="password"
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
          <PasswordField
            id="confirm_password"
            name="confirm_password"
            label="Confirm new password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />

          {state.error && <p className="text-sm text-danger">{state.error}</p>}

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
