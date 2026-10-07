"use client";

import { useActionState } from "react";
import {
  accountLifecycleByEmailAction,
  bulkAccountLifecycleAction,
  deactivateUserAction,
  reactivateUserAction,
  type BulkDeactivationState,
  type DeactivationState,
} from "@/lib/auth/deactivation-actions";
import { FormMessage } from "@/components/ui/form-message";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";

const initialState: DeactivationState = { error: null, message: null };

/** Deactivate / reactivate one known account (used on each staff card). */
export function AccountStatusButton({ userId, active, name }: { userId: string; active: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(active ? deactivateUserAction : reactivateUserAction, initialState);
  const { askThenSubmit, dialog } = useConfirm();
  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      {dialog}
      <input type="hidden" name="user_id" value={userId} />
      <button
        type="submit"
        disabled={pending}
        onClick={
          active
            ? askThenSubmit({
                title: `Deactivate ${name}?`,
                message: "They are signed out and lose all access immediately.",
                confirmLabel: "Deactivate",
                destructive: true,
              })
            : undefined
        }
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

const bulkInitialState: BulkDeactivationState = { error: null, results: [] };

/** S1-16: deactivate or restore several accounts at once from a pasted list of emails (JAGS Admin). */
export function BulkOffboardForm() {
  const [state, formAction, pending] = useActionState(bulkAccountLifecycleAction, bulkInitialState);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (submitter?.value !== "reactivate" && !window.confirm("Deactivate every account in this list? They are signed out and lose all access immediately.")) {
          e.preventDefault();
        }
      }}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink">Bulk offboard or restore accounts</h2>
      <p className="mt-1 text-xs text-muted">
        Paste up to 50 email addresses (one per line, or separated by commas). Each account is handled on its own with the same
        safeguards as above; the result for every address is listed below.
      </p>
      <label className="mt-3 block text-xs font-medium text-ink">
        Emails
        <textarea
          name="emails"
          rows={4}
          required
          className="mt-1 block w-full max-w-xl rounded-md border border-border bg-surface px-3 py-2 text-sm"
          placeholder={"crew1@subcontractor.com\ncrew2@subcontractor.com"}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" name="intent" value="deactivate" disabled={pending} variant="outline">
          {pending ? "Working…" : "Deactivate all"}
        </Button>
        <Button type="submit" name="intent" value="reactivate" disabled={pending} variant="outline">
          Reactivate all
        </Button>
      </div>
      <FormMessage error={state.error} success={null} className="mt-3" />
      {state.results.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" data-testid="bulk-offboard-results">
          {state.results.map((r) => (
            <li key={r.email} className={r.ok ? "text-success" : "text-danger"}>
              {r.email}: {r.detail}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
