"use client";

import { useActionState } from "react";
import { setAiConsentAction, type AiConsentState } from "@/lib/ai/consent-actions";
import { FormMessage } from "@/components/ui/form-message";
import { Tx } from "@/components/domain/tx";
import { Button } from "@/components/ui/button";
import { useKeepFormValues } from "@/lib/hooks/use-keep-form-values";

const initialState: AiConsentState = { error: null, message: null };

/** Admin control to give or withdraw an organisation's AI consent (E-09). Giving it needs the short name typed. */
export function AiConsentControl({ organizationId, slug, consent }: { organizationId: string; slug: string; consent: boolean }) {
  const [state, formAction, pending] = useActionState(setAiConsentAction, initialState);
  const keepValuesSubmit = useKeepFormValues(state, formAction);
  return (
    <form onSubmit={keepValuesSubmit} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="enable" value={consent ? "false" : "true"} />
      {!consent && (
        <label className="text-xs font-medium text-ink">
          <Tx>Type “</Tx>{slug}<Tx>” to confirm</Tx>
          <input name="confirm" autoComplete="off" className="mt-1 block min-h-9 w-44 rounded-md border border-border bg-surface px-2 py-1 text-sm" />
        </label>
      )}
      <Button type="submit" disabled={pending} variant="outline" size="sm">
        {pending ? "Saving…" : consent ? "Withdraw AI consent" : "Give AI consent"}
      </Button>
      {!consent && <p className="basis-full text-xs text-muted"><Tx>This lets the organisation&apos;s content be sent to the AI provider (paid tier only).</Tx></p>}
      <FormMessage error={state.error} success={state.message} className="basis-full" />
    </form>
  );
}
