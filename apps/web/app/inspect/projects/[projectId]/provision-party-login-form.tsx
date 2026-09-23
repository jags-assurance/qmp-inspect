"use client";

import { useActionState, useState } from "react";
import { provisionPartyLoginAction, type ProvisionPartyLoginState } from "@/lib/projects/party-provisioning";

const initialState: ProvisionPartyLoginState = { error: null, tempPassword: null, email: null };

/**
 * Shown next to a party's "No linked login yet" state (project page) once it has a contact email —
 * lets a JAGS Admin actually grant that email platform access, closing the gap
 * addProjectPartyAction's own comment flagged: adding a party only ever stored the email as text,
 * nothing created an account. See lib/projects/party-provisioning.ts for the two paths (link an
 * existing account, or create one with a temporary password) this one form covers.
 *
 * The temporary password is shown exactly once, inline, right after a brand-new account is created
 * — this app sends no invite email of its own (see that file's header comment), so the admin has to
 * relay it out-of-band themselves. It is never re-fetchable after this: closing/losing this banner
 * means resetting the person's password instead (forgot-password, or a future admin reset action).
 */
export function ProvisionPartyLoginForm({
  projectPartyId,
  contactEmail,
}: {
  projectPartyId: string;
  contactEmail: string | null;
}) {
  const [state, formAction, pending] = useActionState(provisionPartyLoginAction, initialState);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(contactEmail ?? "");

  if (state.tempPassword && state.email) {
    return (
      <div className="mt-1 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-xs">
        <p className="font-medium text-ink">Account created for {state.email}</p>
        <p className="mt-0.5 text-muted">
          Temporary password (shown once — copy it now and share it directly with this person; they must
          change it on first sign-in):
        </p>
        <p className="mt-1 select-all rounded bg-surface px-2 py-1 font-mono text-[11px] text-ink">{state.tempPassword}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-burgundy hover:underline">
        Grant platform access
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="project_party_id" value={projectPartyId} />
      <input
        name="email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="person@company.com"
        className="w-44 rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
      />
      <button type="submit" disabled={pending} className="text-burgundy hover:underline disabled:opacity-50">
        {pending ? "Granting…" : "Confirm"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-muted hover:underline">
        Cancel
      </button>
      {state.error && <span className="w-full text-danger">{state.error}</span>}
    </form>
  );
}
