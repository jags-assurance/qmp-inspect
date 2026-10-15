"use client";

import { useActionState, useState } from "react";
import { updatePasswordAction, type UpdatePasswordState } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/domain/password-field";
import { FormMessage } from "@/components/ui/form-message";
import { Tx } from "@/components/domain/tx";

const initialState: UpdatePasswordState = { error: null };

export function ResetPasswordForm({ isForced }: { isForced: boolean }) {
  const [state, formAction, pending] = useActionState(updatePasswordAction, initialState);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  return (
    <>
      <h1 className="text-2xl font-semibold text-ink"><Tx>Set a new password</Tx></h1>
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

        <p id="pw-hint" className="text-xs text-muted">
          <Tx>Use at least 8 characters, avoid common passwords and don&apos;t include your email. Both fields must match.</Tx>
        </p>
        <FormMessage error={state.error} />

        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </>
  );
}
