"use client";

import { useActionState } from "react";
import { setAiConsentAction, type AiConsentState } from "@/lib/ai/consent-actions";
import { FormMessage } from "@/components/ui/form-message";

const initialState: AiConsentState = { error: null, message: null };

/** Admin control to give or withdraw an organisation's AI consent (E-09). Giving it needs the short name typed. */
export function AiConsentControl({ organizationId, slug, consent }: { organizationId: string; slug: string; consent: boolean }) {
  const [state, formAction, pending] = useActionState(setAiConsentAction, initialState);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="enable" value={consent ? "false" : "true"} />
      {!consent && (
        <label className="text-xs font-medium text-ink">
          Type “{slug}” to confirm
          <input name="confirm" autoComplete="off" className="mt-1 block min-h-9 w-44 rounded-md border border-border bg-surface px-2 py-1 text-sm" />
        </label>
      )}
      <button type="submit" disabled={pending} className="min-h-9 rounded-md border border-border px-3 text-xs font-medium text-burgundy hover:bg-off-white disabled:opacity-50">
        {pending ? "Saving…" : consent ? "Withdraw AI consent" : "Give AI consent"}
      </button>
      {!consent && <p className="basis-full text-xs text-muted">This lets the organisation&apos;s content be sent to the AI provider (paid tier only).</p>}
      <FormMessage error={state.error} success={state.message} className="basis-full" />
    </form>
  );
}
