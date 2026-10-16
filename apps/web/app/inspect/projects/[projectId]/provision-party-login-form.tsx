"use client";

import { useActionState, useState } from "react";
import { provisionPartyLoginAction, type ProvisionPartyLoginState } from "@/lib/projects/party-provisioning";
import { formatDateTime } from "@/lib/dates/format";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Button } from "@/components/ui/button";

const initialState: ProvisionPartyLoginState = { error: null, tempPassword: null, email: null, expiresAt: null };

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
  hasLogin = false,
  isAdmin = false,
}: {
  projectPartyId: string;
  contactEmail: string | null;
  /** True once the party already has a login — the form then renders nothing unless it just
   *  created one and still has the one-time temporary password to show. */
  hasLogin?: boolean;
  /** A JAGS Admin may override the organisation seat limit (with a reason, audited). */
  isAdmin?: boolean;
}) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(provisionPartyLoginAction, initialState);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(contactEmail ?? "");

  // The one-time password is copied into component state the moment the action returns it, so the
  // panel survives re-renders / page revalidation until the admin dismisses it. Memory only: never
  // localStorage/sessionStorage, never logged.
  const [held, setHeld] = useState<ProvisionPartyLoginState | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (state.tempPassword && state.email && held?.tempPassword !== state.tempPassword && dismissed !== state.tempPassword) {
    setHeld(state);
    setCopied(false);
  }

  if (held?.tempPassword && held.email) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(held.tempPassword ?? "");
        setCopied(true);
      } catch {
        setCopied(false);
      }
    };
    return (
      <div className="mt-1 rounded-md border border-warning/40 bg-warning/5 px-2 py-1.5 text-xs">
        <p className="font-medium text-ink"><Tx>Account created for</Tx> {held.email}</p>
        <p className="mt-0.5 text-muted">
          {held.emailStatus === "sent" ? (
            <Tx>Email sent: a sign-in link was emailed (the password is not in the email).</Tx>
          ) : held.emailStatus === "failed" ? (
            <Tx>Email could not be sent. Share the sign-in link manually.</Tx>
          ) : (
            <Tx>Email not configured - share the sign-in link manually.</Tx>
          )}
        </p>
        <p className="mt-0.5 text-muted">
          <Tx>Temporary password (shown once — copy it now and share it directly with this person; they must change it on first sign-in</Tx>
          {held.expiresAt ? `; it stops working on ${formatDateTime(held.expiresAt, "UTC")} UTC if unused` : ""}):
        </p>
        <p className="mt-1 select-all rounded bg-surface px-2 py-1 font-mono text-xs text-ink">{held.tempPassword}</p>
        <div className="mt-1 flex gap-3">
          <Button type="button" onClick={copy} variant="link">
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" onClick={() => { setDismissed(held.tempPassword); setHeld(null); }} variant="link">
            <Tx>I have shared it</Tx>
          </Button>
        </div>
      </div>
    );
  }

  if (hasLogin) return null;

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} variant="link">
        <Tx>Grant platform access</Tx>
      </Button>
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
        placeholder={tl("person@company.com")}
        className="w-44 rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
      />
      {isAdmin && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1 text-muted">
            <input type="checkbox" name="seat_override" /> <Tx>Override seat limit (Admin, audited)</Tx>
          </label>
          <input aria-label={tl("Reason (required if ticked)")}
            name="seat_override_reason"
            placeholder={tl("Reason (required if ticked)")}
            className="w-44 rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-burgundy"
          />
        </div>
      )}
      <Button type="submit" disabled={pending} variant="link">
        {pending ? "Granting…" : "Confirm"}
      </Button>
      <Button type="button" onClick={() => setOpen(false)} variant="link-muted">
        <Tx>Cancel</Tx>
      </Button>
      {state.error && <span className="w-full text-danger">{state.error}</span>}
    </form>
  );
}
