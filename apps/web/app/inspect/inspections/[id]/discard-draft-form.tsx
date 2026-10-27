"use client";

import { useRestoreOnError } from "@/lib/hooks/use-keep-form-values";
import { useActionState } from "react";
import { discardInspectionDraftAction, type DiscardDraftState } from "@/lib/checklists/lifecycle-actions";
import { Button } from "@/components/ui/button";
import { Tx } from "@/components/domain/tx";
import { useTranslate } from "@/lib/i18n/locale-context";
import { Disclosure } from "@/components/ui/disclosure";

const initialState: DiscardDraftState = { error: null };

/** Removes an abandoned draft (never a completed inspection) with a short reason; asks to confirm first. */
export function DiscardDraftForm({ inspectionRecordId }: { inspectionRecordId: string }) {
  const tl = useTranslate();
  const [state, formAction, pending] = useActionState(discardInspectionDraftAction, initialState);
  const captureForm = useRestoreOnError(state);
  return (
    <Disclosure variant="inline" summary={<><Tx>Discard this draft…</Tx></>} className="text-sm">
      <form
        action={formAction}
        className="mt-2 space-y-2"
        onSubmit={(e) => {
        captureForm(e.currentTarget);
        return ((e) => {
          if (!window.confirm(tl("Discard this draft inspection? Its answers and photos will be deleted. This cannot be undone."))) e.preventDefault();
        })(e);
      }}
      >
        <input type="hidden" name="inspection_record_id" value={inspectionRecordId} />
        <p className="text-xs text-muted">
          <Tx>Deletes this unfinished draft with its answers and photos. A completed inspection cannot be discarded.</Tx>
        </p>
        <textarea aria-label={tl("Reason for discarding (required)")}
          name="reason"
          required
          minLength={5}
          rows={2}
          placeholder={tl("Reason for discarding (required)")}
          className="w-full rounded-md border border-border bg-off-white px-3 py-2 text-sm outline-none focus:border-burgundy"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Discarding…" : "Discard this draft"}
        </Button>
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      </form>
</Disclosure>
  );
}
