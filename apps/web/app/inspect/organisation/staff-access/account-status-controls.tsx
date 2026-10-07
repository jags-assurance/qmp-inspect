"use client";

import { useActionState } from "react";
import {
  accountLifecycleByEmailAction,
  deactivateUserAction,
  reactivateUserAction,
  type DeactivationState,
} from "@/lib/auth/deactivation-actions";
import { FormMessage } from "@/components/ui/form-message";
import { Button } from "@/components/ui/button";

const initialState: DeactivationState = { error: null, message: null };

/** Deactivate / reactivate one known account (used on each staff card). */
export function AccountStatusButton({ userId, active, name }: { userId: string; active: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(active ? deactivateUserAction : reactivateUserAction, initialState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (active && !window.confirm(`Deactivate ${name}? They are signed out and lose all access immediately.`)) e.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-9 text-xs font-medium text-burgundy hover:underline disabled:opacity-50"
      >
        {pending ? "Working…" : active ? "Deactivate account" : "Reactivate account"}
      </button>
      <FormMessage error={state.error} success={state.message} className="max-w-xs text-right" />
    </form>
  );
}

/** Offboard any account (staff or an external party user) by email. */
export function OffboardByEmailForm() {
  const [state, formAction, pending] = useActionState(accountLifecycleByEmailAction, initialState);
  return (
    <form action={formAction} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Offboard or restore an account</h2>
      <p className="mt-1 text-xs text-muted">
        Works on any account by email — JAGS staff or an external party user. Deactivating signs the person out, stops
        them signing in again and removes every access grant (recorded, so Reactivate restores them).
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-ink">
          Email
          <input
            name="email"
            type="email"
            required
            className="mt-1 block min-h-11 w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
        <Button type="submit" name="intent" value="deactivate" disabled={pending} variant="outline">
          {pending ? "Working…" : "Deactivate"}
        </Button>
        <Button type="submit" name="intent" value="reactivate" disabled={pending} variant="outline">
          Reactivate
        </Button>
      </div>
      <FormMessage error={state.error} success={state.message} className="mt-3" />
    </form>
  );
}
