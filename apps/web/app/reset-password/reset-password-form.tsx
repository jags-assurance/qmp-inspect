"use client";

import { useActionState, useState } from "react";
import { updatePasswordAction, type UpdatePasswordState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/domain/password-field";

const initialState: UpdatePasswordState = { error: null };

export function ResetPasswordForm({ isForced }: { isForced: boolean }) {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <>
      <h2 className="text-2xl font-semibold text-ink">Set a new password</h2>
      <p className="mt-1 text-sm text-muted">
        {isForced
          ? "For security, you need to set your own password before continuing — you're currently signed in with a temporary one."
          : "Choose a new password for your account."}
      </p>

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

        <p id="pw-hint" className="text-xs text-muted">Use at least 8 characters. Both fields must match.</p>
        {state.error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </>
  );
}
