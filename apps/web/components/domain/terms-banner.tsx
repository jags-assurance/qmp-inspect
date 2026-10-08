"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { acceptTermsAction, type AcceptTermsState } from "@/lib/terms/actions";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";

/**
 * One-time notice asking the signed-in user to accept the terms of use (U7). It is a banner, not a
 * gate: nothing is blocked, "Not now" hides it for this page view, the terms are one click away and
 * Sign out in the account menu is untouched. It disappears for good once acceptance is recorded.
 */
export function TermsBanner() {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState<AcceptTermsState, FormData>(acceptTermsAction, { error: null, accepted: false });
  const [dismissed, setDismissed] = useState(false);

  if (state.accepted || dismissed) return null;

  return (
    <div role="region" aria-label={tl("Terms of use")} className="border-b border-border bg-off-white px-3 py-3 text-sm text-ink sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1">
          <Tx>Please read and accept the</Tx>{" "}
          <Link href="/terms" className="font-medium text-burgundy underline" target="_blank" rel="noopener">
            <Tx>terms of use</Tx>
          </Link>{" "}
          <Tx>and the</Tx>{" "}
          <Link href="/privacy" className="font-medium text-burgundy underline" target="_blank" rel="noopener">
            <Tx>privacy notice</Tx>
          </Link>
          <Tx>. You can keep working while you decide.</Tx>
        </p>
        <form action={formAction} className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-burgundy px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-burgundy"
          >
            {pending ? "Saving…" : "I accept"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="min-h-11 rounded-md border border-border px-4 text-sm font-medium text-ink hover:bg-surface"
          >
            <Tx>Not now</Tx>
          </button>
        </form>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
