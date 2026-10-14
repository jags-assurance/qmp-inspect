"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { acceptTermsAction, type AcceptTermsState } from "@/lib/terms/actions";
import { Tx } from "@/components/domain/tx";

/**
 * The one-time terms acceptance (U7), shown inside the account menu with a dot on the avatar until it is
 * done. Not a gate: nothing is blocked. Disappears for good once acceptance is recorded.
 */
export function TermsMenuSection({ onAccepted }: { onAccepted: () => void }) {
  const [stale, setStale] = useState(false);
  // A page left open across a deploy calls a server action id that no longer exists and the call throws;
  // catch it so the menu shows a reload prompt instead of the app error boundary.
  const [state, formAction, pending] = useActionState<AcceptTermsState, FormData>(
    async (prev) => {
      try {
        setStale(false);
        const next = await acceptTermsAction(prev);
        if (next.accepted) onAccepted();
        return next;
      } catch {
        setStale(true);
        return { error: null, accepted: false };
      }
    },
    { error: null, accepted: false }
  );

  if (state.accepted) return null;

  return (
    <div className="space-y-2 border-b border-border px-4 py-3 text-sm text-ink">
      <p>
        <Tx>Please accept the</Tx>{" "}
        <Link href="/terms" className="font-medium text-burgundy underline" target="_blank" rel="noopener">
          <Tx>terms of use</Tx>
        </Link>{" "}
        <Tx>and the</Tx>{" "}
        <Link href="/privacy" className="font-medium text-burgundy underline" target="_blank" rel="noopener">
          <Tx>privacy notice</Tx>
        </Link>
        .
      </p>
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 w-full rounded-md bg-burgundy px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "I accept"}
        </button>
      </form>
      {stale && (
        <p role="alert" className="text-xs text-danger">
          <Tx>This page is out of date.</Tx>{" "}
          <button type="button" onClick={() => window.location.reload()} className="font-medium underline">
            <Tx>Reload page</Tx>
          </button>
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
